import { headers } from "next/headers";
import { db } from "./db";
import { users } from "./db/schema";
import { eq } from "drizzle-orm";

export const ReplitAuth = {
  /**
   * Retrieves the current user's Replit identity from headers.
   * If the user doesn't exist in our DB yet, it creates them.
   */
  async getCurrentUser() {
    const headerList = await headers();
    const replitId = headerList.get("x-replit-user-id");
    const username = headerList.get("x-replit-user-name");

    if (!replitId) return null;

    // 1. Check if user exists in our local PostgreSQL
    let user = await db.query.users.findFirst({
      where: eq(users.replitId, replitId),
    });

    // 2. If not, auto-provision the user (First user is usually the Admin)
    if (!user && username) {
      const allUsers = await db.select().from(users);
      const isFirstUser = allUsers.length === 0;

      const newUser = await db.insert(users).values({
        replitId,
        username,
        role: isFirstUser ? "admin" : "editor",
      }).returning();
      
      user = newUser[0];
    }

    return user;
  },

  /**
   * Simple check to see if the current user is an Admin
   */
  async isAdmin() {
    const user = await this.getCurrentUser();
    return user?.role === "admin";
  }
};
