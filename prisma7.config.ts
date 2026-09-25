/// <reference types="node" />
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/prisma-schema",
  migrations: {
    path: "prisma/prisma-schema/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
