import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { mailer } from "../auth/mailer.js";

const DAILY_TICKET_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

async function notifyAdmin(subject: string, body: string) {
  if (!env.ADMIN_EMAIL) {
    console.warn("ADMIN_EMAIL not set — support message stored but no notification sent");
    return;
  }
  await mailer.send(env.ADMIN_EMAIL, subject, body).catch((err) => {
    console.error("admin support notification email failed:", (err as Error).message);
  });
}

export async function createTicket(userId: string, message: string) {
  const dayAgo = new Date(Date.now() - DAY_MS);
  const recentCount = await prisma.supportTicket.count({
    where: { userId, createdAt: { gte: dayAgo } },
  });
  if (recentCount >= DAILY_TICKET_LIMIT) {
    throw new Error(`You've reached your limit of ${DAILY_TICKET_LIMIT} new tickets today. Try again later.`);
  }

  const ticket = await prisma.supportTicket.create({
    data: { userId, messages: { create: { sender: "USER", body: message.trim() } } },
    include: { messages: true },
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await notifyAdmin(`New support ticket from ${user.email}`, message.trim());

  return ticket;
}

async function assertOwnedOpenTicket(ticketId: string, userId: string) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket || ticket.userId !== userId) throw new Error("Ticket not found");
  if (ticket.status === "CLOSED") throw new Error("This ticket is closed");
  return ticket;
}

export async function replyAsUser(ticketId: string, userId: string, message: string) {
  await assertOwnedOpenTicket(ticketId, userId);

  const reply = await prisma.supportTicketMessage.create({
    data: { ticketId, sender: "USER", body: message.trim() },
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await notifyAdmin(`New reply on support ticket ${ticketId} from ${user.email}`, message.trim());

  return reply;
}

export async function replyAsAdmin(ticketId: string, message: string) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new Error("Ticket not found");
  return prisma.supportTicketMessage.create({
    data: { ticketId, sender: "ADMIN", body: message.trim() },
  });
}

export function getOpenTicketsForUser(userId: string) {
  return prisma.supportTicket.findMany({
    where: { userId, status: "OPEN" },
    include: { messages: { orderBy: { createdAt: "asc" } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getTicketForUser(ticketId: string, userId: string) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket || ticket.userId !== userId) throw new Error("Ticket not found");
  return ticket;
}

export function getAllTicketsForAdmin() {
  return prisma.supportTicket.findMany({
    include: {
      user: { select: { email: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
}

export async function clearTicket(ticketId: string) {
  return prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status: "CLOSED", clearedAt: new Date() },
  });
}
