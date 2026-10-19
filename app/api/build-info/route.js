import { resolveBuildId, resolveBuildTime, formatBuildDateTime } from "../../lib/buildInfo.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const isStaging = process.env.NEXT_PUBLIC_APP_ENV === "staging";

  return Response.json(
    {
      success: true,
      buildId: resolveBuildId(),
      buildTime: formatBuildDateTime(resolveBuildTime()),
      environment: isStaging ? "STAGING" : "PRODUCTION",
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
