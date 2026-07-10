import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  JWT_SECRET: required("JWT_SECRET"),
  PORT: Number(process.env.PORT ?? 3333),
  PUBLIC_URL: process.env.PUBLIC_URL ?? "http://localhost:3333",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  UAZAPI_BASE_URL: process.env.UAZAPI_BASE_URL ?? "",
  UAZAPI_ADMIN_TOKEN: process.env.UAZAPI_ADMIN_TOKEN ?? "",
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
};
