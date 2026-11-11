import { createFileRoute, redirect } from "@tanstack/react-router";

/** The Portuguese address of the download page goes to `/download`, keeping the system and chip it asks for. */
export const Route = createFileRoute("/baixar")({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/download",
      search: search as { system?: "mac" | "windows" | "linux"; arch?: "arm64" },
      replace: true,
    });
  },
});
