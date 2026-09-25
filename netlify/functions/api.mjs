import { getStore } from "@netlify/blobs";
import { handle } from "../lib/core.mjs";

export default async (req) => {
  const store = getStore({ name: "kasa", consistency: "strong" });
  return handle(req, store, process.env.APP_PASSWORD);
};

export const config = { path: "/api/*" };
