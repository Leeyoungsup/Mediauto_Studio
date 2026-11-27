"""Log application requests using route templates instead of raw URLs."""

import logging

from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("uvicorn.error")
polling_routes = {
    "/api/integration/{organization}/status",
    "/api/clinical/{organization}/notifications",
    "/api/clinical/{organization}/request-notifications",
    "/api/clinical/{organization}/cases/{case_id}/review-room",
    "/api/clinical/{organization}/cases/{case_id}/report",
    "/api/clinical/{organization}/related-comparisons/{link_id}",
}


class AccessLogMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        path = scope.get("path", "")
        if scope["type"] != "http" or (path != "/" and not path.startswith("/api/")):
            await self.app(scope, receive, send)
            return

        def log(status: int):
            route = "/" if path == "/" else (getattr(scope.get("route"), "path", None) or "/api/*")
            method = scope["method"]
            if method == "GET" and status < 400 and (
                route in polling_routes or route.endswith("/{stage}/{x}/{y}.jpeg")
            ):
                return
            client = scope.get("client")
            logger.info("Access %s %s %s %d", client[0] if client else "-", method, route, status)

        response_started = False

        async def log_response(message: Message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                log(message["status"])
            await send(message)

        try:
            await self.app(scope, receive, log_response)
        except Exception:
            if not response_started:
                log(500)
            raise
