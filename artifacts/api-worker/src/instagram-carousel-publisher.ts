/**
 * Instagram Carousel publishing via Facebook Login Graph API.
 * Create 2–10 unpublished child image containers, wait for readiness, create
 * one CAROUSEL parent, then send exactly one media_publish. No automatic retry.
 */
const GRAPH = "https://graph.facebook.com/v27.0/";
type GraphReply = {
  id?: string;
  status_code?: string;
  permalink?: string;
  error?: { code?: number; error_subcode?: number };
};
export class InstagramCarouselError extends Error {
  constructor(code: string) { super(code); this.name = "InstagramCarouselError"; }
}
export function safeCarouselError(error: unknown): string {
  if (error instanceof InstagramCarouselError &&
      /^IG_CAROUSEL_(?:META_\d+(?:_\d+)?|API_FAILED|INVALID_MEDIA|MEDIA_FAILED|NOT_READY|UNEXPECTED|BAD_INPUT)$/.test(error.message)) {
    return error.message;
  }
  return "IG_CAROUSEL_API_FAILED";
}
async function callGraph(token: string, endpoint: string, method: "GET" | "POST", params?: Record<string,string>): Promise<GraphReply> {
  const response = await fetch(GRAPH + endpoint, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json",
      ...(method==="POST" ? { "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8" } : {}),
    },
    ...(method==="POST" ? { body: new URLSearchParams(params).toString() } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(()=>null) as GraphReply | null;
  if (!response.ok || !data || data.error) {
    const code=data?.error?.code, sub=data?.error?.error_subcode;
    throw new InstagramCarouselError(typeof code==="number"
      ? "IG_CAROUSEL_META_" + code + (typeof sub==="number" ? "_" + sub : "")
      : "IG_CAROUSEL_API_FAILED");
  }
  return data;
}
async function pollContainers(
  token: string, ids: readonly string[], wait:(ms:number)=>Promise<void>,
):Promise<void>{
  const ready=new Set<string>();
  for(let attempt=0;attempt<7;attempt++){
    if(attempt>0)await wait(3_000);
    for(const id of ids){
      if(ready.has(id))continue;
      const result=await callGraph(token,id+"?fields=status_code","GET");
      if(result.status_code==="FINISHED"){ ready.add(id);continue; }
      if(result.status_code==="IN_PROGRESS")continue;
      if(result.status_code==="ERROR"||result.status_code==="EXPIRED"||result.status_code==="PUBLISHED"){
        throw new InstagramCarouselError("IG_CAROUSEL_MEDIA_FAILED");
      }
      throw new InstagramCarouselError("IG_CAROUSEL_UNEXPECTED");
    }
    if(ready.size===ids.length)return;
  }
  throw new InstagramCarouselError("IG_CAROUSEL_NOT_READY");
}

export async function publishInstagramCarousel(
  accountId:string, token:string, urls:readonly string[], caption:string,
  wait:(ms:number)=>Promise<void>=(ms)=>new Promise(r=>setTimeout(r,ms)),
):Promise<{mediaId:string;permalink:string|null}>{
  if(!/^\d+$/.test(accountId)||!token||urls.length<2||urls.length>10||caption.length>2200||!caption.trim()){
    throw new InstagramCarouselError("IG_CAROUSEL_BAD_INPUT");
  }
  const children:string[]=[];
  for(const url of urls){
    const created=await callGraph(token, accountId+"/media", "POST", {
      image_url:url, is_carousel_item:"true",
    });
    if(!created.id || !/^\d+$/.test(created.id))throw new InstagramCarouselError("IG_CAROUSEL_INVALID_MEDIA");
    children.push(created.id);
  }
  await pollContainers(token,children,wait);
  const parent=await callGraph(token, accountId+"/media", "POST", {
    media_type:"CAROUSEL", children:children.join(","),caption,
  });
  if(!parent.id || !/^\d+$/.test(parent.id))throw new InstagramCarouselError("IG_CAROUSEL_INVALID_MEDIA");
  await pollContainers(token,[parent.id],wait);
  // Uncertain reply must never trigger an automatic second media_publish.
  const published=await callGraph(token,accountId+"/media_publish","POST",{creation_id:parent.id});
  if(!published.id||!/^\d+$/.test(published.id))throw new InstagramCarouselError("IG_CAROUSEL_UNEXPECTED");
  try{
    const detail=await callGraph(token,published.id+"?fields=permalink","GET");
    if(detail.permalink && /^https:\/\/www\.instagram\.com\//.test(detail.permalink))
      return {mediaId:published.id,permalink:detail.permalink};
  }catch{/* permalink optional, never republish */}
  return {mediaId:published.id,permalink:null};
}
