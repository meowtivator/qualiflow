-- 에이전트 토큰 검증 + 하트비트.
-- 에이전트는 로그인 사용자(JWT)가 아니라 RLS를 직접 통과하지 못한다 → pair_agent와 같은
-- SECURITY DEFINER 패턴으로만 agents를 조회한다. 평문 토큰은 절대 받지 않고 HMAC 해시만 받는다
-- (pepper는 서버 env에만, DB엔 token_hash만). 일치하면 신원(agent_id, workspace_id)을 돌려주고,
-- 동시에 last_seen_at을 찍어 "방금 살아있었음"을 갱신한다(= 요청마다 하트비트, 별도 엔드포인트 불필요).

create or replace function public.resolve_agent_by_token(p_token_hash text)
returns table (agent_id uuid, workspace_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.agents
     set last_seen_at = now()
   where token_hash = p_token_hash
     and revoked_at is null               -- 해제(revoke)된 토큰은 거부
  returning agents.id, agents.workspace_id;  -- 테이블 컬럼으로 한정(OUT 파라미터명과의 모호성 제거). 없으면 빈 결과 = 인증 실패
end;
$$;

-- 에이전트 요청은 로그인 세션이 없으므로 anon(publishable) 키로 호출된다(pair_agent와 동일).
grant execute on function public.resolve_agent_by_token(text) to anon;
