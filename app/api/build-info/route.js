import { resolveBuildId, resolveBuildTime, formatBuildDateTime } from "../../lib/buildInfo.js";
import { resolveAppEnvironmentLabel } from "../../lib/appEnvironment.js";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      success: true,
      buildId: resolveBuildId(),
      buildTime: formatBuildDateTime(resolveBuildTime()),
      environment: resolveAppEnvironmentLabel(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
