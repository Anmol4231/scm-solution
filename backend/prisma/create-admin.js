const { PrismaClient, UserRole } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const fullPermissions = {
  dashboard: ["view"],
  users: ["view", "create", "edit", "delete"],
  facilities: ["view", "create", "edit", "delete"],
  roles: ["view", "create", "edit", "delete"],
  stockCategories: ["view", "create", "edit", "delete"],
  medicines: ["view", "create", "edit", "delete"],
  orders: ["view", "create", "edit", "delete"],
  receiveStock: ["view", "create", "edit", "approve"],
  stock: ["view", "create", "edit", "approve"],
  expiry: ["view", "edit", "approve"],
  transfers: ["view", "create", "edit", "approve"],
  returns: ["view", "create", "edit", "approve"],
  patients: ["view", "create", "edit"],
  prescriptions: ["view", "create", "edit"],
  dispensing: ["view", "create"],
  alerts: ["view", "approve"],
  audit: ["view"],
  recovery: ["view", "approve"]
};

async function main() {
  console.log("Creating Super Admin...");

  let adminRole = await prisma.role.findUnique({
    where: { code: "ADMIN" }
  });

  if (!adminRole) {
    console.log("Creating ADMIN role...");

    adminRole = await prisma.role.create({
      data: {
        name: "Administrator",
        code: "ADMIN",
        description: "Full system access",
        isSystem: true,
        isActive: true,
        scopeAllFacilities: true,
        permissions: fullPermissions
      }
    });
  }

  const existing = await prisma.user.findUnique({
    where: {
      email: "admin@stocktrackrx.com"
    }
  });

  if (existing) {
    console.log("Super Admin already exists.");
    return;
  }

  const passwordHash = await bcrypt.hash("Admin@123", 10);

  const user = await prisma.user.create({
    data: {
      email: "admin@stocktrackrx.com",
      passwordHash,

      firstName: "System",
      lastName: "Administrator",

      role: UserRole.SUPER_ADMIN,

      roleId: adminRole.id,

      facilityId: null,

      isActive: true,
      mustChangePassword: false,
      passwordChangedAt: new Date()
    }
  });

  console.log("====================================");
  console.log("SUPER ADMIN CREATED SUCCESSFULLY");
  console.log("====================================");
  console.log("Email    : admin@stocktrackrx.com");
  console.log("Password : Admin@123");
  console.log("Role     : SUPER_ADMIN");
  console.log("Access   : ALL FACILITIES");
  console.log("====================================");
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });