import { productsTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import {
  composeInstagramCarouselCaption, instagramCarouselReady,
  parseCarouselIds, validCarouselImageUrl,
} from "./instagram-carousel-policy";
import { publishInstagramCarousel, safeCarouselError } from "./instagram-carousel-publisher";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
function json(value:unknown,status=200):Response{
  return Response.json(value,{status,headers:{"Access-Control-Allow-Origin":"*","Cache-Control":"no-store"}});
}

export async function handleInstagramCarouselRequest(request:Request,db:Db,env:Env):Promise<Response|null>{
  const path=new URL(request.url).pathname;
  const isPreview=path==="/api/owner/instagram/carousel/preview";
  const isPublish=path==="/api/owner/instagram/carousel/publish";
  if(!isPreview&&!isPublish)return null;
  if(request.method!=="POST")return json({error:"طريقة الطلب غير مدعومة"},405);
  const user=await getCurrentUser(db,request,env);
  if(!user)return json({error:"يجب تسجيل الدخول أولًا"},401);
  if(user.isOwner!==true)return json({error:"المالك فقط يستطيع نشر صور إنستغرام"},403);
  const body=await request.json().catch(()=>null) as {productIds?:unknown;confirmed?:unknown}|null;
  const productIds=parseCarouselIds(body?.productIds);
  if(!productIds)return json({error:"اختَر من 2 إلى 10 موديلات مختلفة لمنشور إنستغرام"},400);
  if(isPublish&&body?.confirmed!==true)return json({error:"يلزم تأكيد صريح قبل نشر الصور"},400);

  const fetched=await db.select({
    id:productsTable.id,nameAr:productsTable.nameAr,name:productsTable.name,
    image:productsTable.image,isHidden:productsTable.isHidden,deletedAt:productsTable.deletedAt,
  }).from(productsTable).where(inArray(productsTable.id,productIds));
  const byId=new Map(fetched.map(p=>[p.id,p]));
  const products=productIds.map(id=>byId.get(id));
  if(products.some(p=>!p||p.isHidden||p.deletedAt||!validCarouselImageUrl(p.image))){
    return json({error:"أحد الموديلات غير موجود أو مخفي أو رابط صورته غير صالح"},400);
  }
  // Products validated above; preserve user's selected order, not DB result order.
  const selected=products as Array<{id:number;nameAr:string|null;name:string|null;image:string}>;
  let caption:string;
  try{caption=composeInstagramCarouselCaption(selected);}
  catch{return json({error:"الوصف طويل جدًا؛ اختَر موديلات بأسماء أقصر"},400);}
  const configured=instagramCarouselReady(env);
  const preview={
    configured,
    products:selected.map(p=>({
      id:p.id,name:p.nameAr?.trim()||p.name?.trim()||"موديل "+p.id,image:p.image,
    })),
    caption,
    note:"إنستغرام يعرض وصفًا واحدًا للمنشور الكامل، وليس وصفًا مستقلًا تحت كل صورة. الروابط في الوصف غير قابلة للنقر.",
  };
  if(isPreview)return json(preview);
  if(!configured)return json({error:"نشر Carousel ما زال معطّلًا من Worker إلى حين اعتماد تجربة الصور المتعددة."},503);

  try{
    const result=await publishInstagramCarousel(
      env.META_INSTAGRAM_ACCOUNT_ID!.trim(),
      env.META_INSTAGRAM_ACCESS_TOKEN_NEXT!.trim(),
      selected.map(p=>p.image), caption,
    );
    return json({
      ok:true,mediaId:result.mediaId,permalink:result.permalink,productIds,
      note:"نُشر منشور Carousel بنجاح. تحقق من ظهوره للعامة قبل محاولة أخرى.",
    });
  }catch(error){
    // Do not automatically retry because Meta may have published despite a network error.
    return json({
      error:"لم نتمكن من تأكيد النشر ("+safeCarouselError(error)+"). تحقق من الحساب قبل إعادة المحاولة لمنع التكرار.",
    },502);
  }
}
