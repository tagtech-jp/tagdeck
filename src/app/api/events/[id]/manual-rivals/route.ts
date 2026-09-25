import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { eventSimulators } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const manualRivalsSchema = z.object({
  rivals: z.array(
    z.object({
      name: z.string().min(1).max(100),
      score: z.number().int().nonnegative(),
      targetScore: z.number().int().nonnegative().optional(),
    })
  ),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = manualRivalsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const db = createDbClient();

  const result = await db
    .update(eventSimulators)
    .set({
      manualRivals: parsed.data.rivals,
      updatedAt: new Date(),
    })
    .where(and(eq(eventSimulators.id, id), eq(eventSimulators.userId, user.id)))
    .returning({ id: eventSimulators.id });

  if (result.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
