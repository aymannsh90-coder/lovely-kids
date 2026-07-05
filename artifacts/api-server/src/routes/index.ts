import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ordersRouter from "./orders";
import productsRouter from "./products";
import notificationsRouter from "./notifications";
import imagesRouter from "./images";
import authRouter from "./auth";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ordersRouter);
router.use(productsRouter);
router.use(notificationsRouter);
router.use(imagesRouter);
router.use(authRouter);
router.use(settingsRouter);

export default router;
