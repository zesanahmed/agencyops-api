import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { login, logout, me, refresh, register } from "./auth.controller.js";
import { authenticate } from "./auth.middleware.js";
import { loginSchema, registerSchema } from "./auth.validation.js";

const authRouter: Router = Router();

authRouter.post("/register", validate({ body: registerSchema }), register);
authRouter.post("/login", validate({ body: loginSchema }), login);
authRouter.post("/refresh", refresh);
authRouter.post("/logout", logout);
authRouter.get("/me", authenticate, me);

export { authRouter };
