// 페어링: 웹에서 발급받은 코드를 클라우드에 제출해 에이전트 토큰을 받고, 키체인에 저장한다.
// 평문 토큰은 응답으로 1회 받아 즉시 키체인에 넣고, 메모리 밖으로 내보내지 않는다.

import { hostname, platform } from "node:os";

import { CLOUD_BASE_URL } from "./config";
import { saveToken } from "./token-store";

export type PairResult = {
  agentId: string;
  workspaceId: string;
};

export async function pair(code: string): Promise<PairResult> {
  const response = await fetch(`${CLOUD_BASE_URL}/api/agents/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, label: hostname(), platform: platform() })
  });

  const data = (await response.json()) as {
    ok?: boolean;
    agentId?: string;
    agentToken?: string;
    workspaceId?: string;
    message?: string;
  };

  if (!response.ok || !data.ok || !data.agentToken || !data.agentId || !data.workspaceId) {
    throw new Error(data.message ?? "페어링에 실패했습니다(코드 확인).");
  }

  await saveToken(data.agentToken);

  return { agentId: data.agentId, workspaceId: data.workspaceId };
}
