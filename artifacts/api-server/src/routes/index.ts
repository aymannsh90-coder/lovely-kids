import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ordersRouter from "./orders";
import productsRouter from "./products";
import notificationsRouter from "./notifications";
import imagesRouter from "./images";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ordersRouter);
router.use(productsRouter);
router.use(notificationsRouter);
router.use(imagesRouter);

export default router;
