export default {

  async fetch(request) {

    const url = new URL(request.url);

    if (url.pathname === "/health") {

      return Response.json({

        status: "ok",

        service: "Kripto Analiz MCP"

      });

    }

    return new Response("Kripto Analiz MCP sunucusu hazır.", {

      headers: { "Content-Type": "text/plain; charset=utf-8" }

    });

  }

};
