import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { env } from "../config/env.js";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });

export const prisma = new PrismaClient<
  Prisma.PrismaClientOptions,
  never,
  undefined
>({ adapter });
