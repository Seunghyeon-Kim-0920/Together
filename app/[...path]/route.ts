import { NextResponse } from "next/server";

const assetLinkStatements = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.together.travel",
      sha256_cert_fingerprints: [
        "48:B5:B1:3F:A7:03:D2:D9:57:67:3F:F1:08:60:B5:6B:73:C1:2E:C8:15:A5:50:AE:31:1A:B4:51:C1:6C:7E:B7",
      ],
    },
  },
] as const;

export function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  return context.params.then(({ path }) => {
    if (path.length === 2 && path[0] === ".well-known" && path[1] === "assetlinks.json") {
      return NextResponse.json(assetLinkStatements, {
        headers: { "cache-control": "public, max-age=3600" },
      });
    }

    return new NextResponse("Not Found", { status: 404 });
  });
}
