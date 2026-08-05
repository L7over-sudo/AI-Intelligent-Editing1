import "server-only";

import { getPrisma } from "@stickmotion/db";

export async function getCurrentUser() {
  const prisma = getPrisma();
  const email = process.env.DEV_USER_EMAIL ?? "demo@stickmotion.local";
  const name = process.env.DEV_USER_NAME ?? "Demo Creator";

  return prisma.user.upsert({
    where: { email },
    update: { name },
    create: { email, name },
  });
}

