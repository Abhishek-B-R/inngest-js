import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { fromAny } from "@total-typescript/shoehorn";
import type { Response } from "express";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { Inngest } from "./components/Inngest.ts";
import * as FastifyHandler from "./fastify.ts";
import { testFramework } from "./test/helpers.ts";

class MockFastifyReply {
  constructor(public res: Response) {}

  public header(key: string, value: string) {
    this.res.header(key, value);
  }

  public code(code: number) {
    this.res.statusCode = code;
  }

  public send(body: unknown) {
    this.res.send(body);
  }
}

testFramework("Fastify", FastifyHandler, {
  transformReq: (req, res): [req: FastifyRequest, reply: FastifyReply] => {
    return [fromAny(req), fromAny(new MockFastifyReply(res))];
  },
});

describe("Fastify over HTTP/2", () => {
  test("builds the request URL from the :authority header", async () => {
    const inngest = new Inngest({ id: "test", isDev: true });
    const fn = inngest.createFunction(
      { id: "fn", triggers: [{ event: "demo/event.sent" }] },
      () => "ok",
    );

    const app = Fastify({ http2: true });
    await app.register(FastifyHandler.default, {
      client: inngest,
      functions: [fn],
    });
    await app.listen({ port: 0, host: "127.0.0.1" });

    const { port } = app.server.address() as AddressInfo;
    const session = http2.connect(`http://127.0.0.1:${port}`);

    try {
      const res = await new Promise<{ status: number; body: string }>(
        (resolve, reject) => {
          const req = session.request({
            ":method": "GET",
            ":path": "/api/inngest",
          });
          let status = 0;
          let body = "";
          req.setEncoding("utf8");
          req.on("response", (headers) => {
            status = Number(headers[":status"]);
          });
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", () => resolve({ status, body }));
          req.on("error", reject);
          req.end();
        },
      );

      expect(res.body).not.toContain("Invalid URL");
      expect(res.status).toBe(200);
    } finally {
      session.close();
      await app.close();
    }
  });
});
