import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/require-auth.js";
import { getUserTaxStatementData, toCsv } from "./statement.service.js";

export async function taxRoutes(app: FastifyInstance) {
  app.get(
    "/tax/statement",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["tax"],
        summary: "Per-year WHT statement: every credit (token amount + naira value at withholding), for annual returns",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          required: ["year"],
          properties: {
            year: { type: "string", description: "e.g. 2026" },
            format: { type: "string", enum: ["json", "csv"], default: "json" },
          },
        },
      },
    },
    async (req, reply) => {
      const { year, format } = req.query as { year: string; format?: "json" | "csv" };
      const parsedYear = Number(year);
      if (!Number.isInteger(parsedYear)) {
        return reply.code(400).send({ error: "year must be an integer, e.g. 2026" });
      }

      const statement = await getUserTaxStatementData(req.userId!, parsedYear);
      if (format === "csv") {
        reply.header("Content-Type", "text/csv");
        reply.header("Content-Disposition", `attachment; filename="tax-statement-${parsedYear}.csv"`);
        return reply.send(toCsv(statement));
      }
      return reply.send(statement);
    },
  );
}
