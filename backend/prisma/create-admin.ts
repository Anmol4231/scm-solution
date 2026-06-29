import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Creating initial administrator...");

  const userCount = await prisma.user.count();

  if (userCount > 0) {
    console.log("Users already exist. Bootstrap administrator was not created.");
    return;
  }

  const adminRole = await prisma.role.findUnique({
    where: {
      code: "ADMIN",
    },
  });

  if (!adminRole) {
    console.error("ADMIN role not found.");
    console.error("Run: npm run db:backfill");
    process.exit(1);
  }

  const email = process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  const firstName = process.env.INITIAL_ADMIN_FIRST_NAME || "System";
  const lastName = process.env.INITIAL_ADMIN_LAST_NAME || "Administrator";

  if (!email || !password) {
    console.error("Missing INITIAL_ADMIN_EMAIL or INITIAL_ADMIN_PASSWORD in .env");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const roleId = adminRole.id;

  await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName,
      lastName,

      role: UserRole.SUPER_ADMIN,
      roleId,

      facilityId: null,

      isActive: true,
      mustChangePassword: true,
      passwordChangedAt: new Date(),
    },
  });

  console.log("------------------------------------");
  console.log("SUPER ADMIN CREATED SUCCESSFULLY");
  console.log("------------------------------------");
  console.log(`Email    : ${email}`);
  console.log("Please login and change the password.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });