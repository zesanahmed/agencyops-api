import { Router } from "express";
import { validate } from "../../middlewares/validate.js";
import { authRateLimiter, refreshRateLimiter } from "../../middlewares/rateLimit.js";
import {
  login,
  logout,
  logoutAll,
  me,
  refresh,
  register,
} from "./auth.controller.js";
import { authenticate } from "./auth.middleware.js";
import { loginSchema, registerSchema } from "./auth.validation.js";

const authRouter: Router = Router();

authRouter.post("/register", authRateLimiter, validate({ body: registerSchema }), register);
authRouter.post("/login", authRateLimiter, validate({ body: loginSchema }), login);
authRouter.post("/refresh", refreshRateLimiter, refresh);
authRouter.post("/logout", logout);
authRouter.post("/logout-all", authenticate, logoutAll);
authRouter.get("/me", authenticate, me);

export { authRouter };
