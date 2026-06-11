"use client";

import { Mail } from "lucide-react";
import { FormEvent, KeyboardEvent, useState } from "react";

type LoginFormProps = {
  initialError?: string;
  initialMessage?: string;
  nextPath: string;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function LoginForm({ initialError, initialMessage, nextPath }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [message, setMessage] = useState(initialMessage ?? "");
  const [isSending, setIsSending] = useState(false);

  async function requestLoginEmail() {
    const normalizedEmail = email.trim().toLowerCase();
    setError("");
    setMessage("");

    if (isSending) {
      return;
    }

    if (!normalizedEmail) {
      setError("이메일을 입력해주세요.");
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setError("올바른 이메일 형식으로 입력해주세요.");
      return;
    }

    setIsSending(true);

    const formData = new FormData();
    formData.set("email", normalizedEmail);
    formData.set("next", nextPath);

    try {
      const response = await fetch("/auth/otp", {
        body: formData,
        headers: {
          Accept: "application/json"
        },
        method: "POST"
      });
      const result = (await response.json().catch(() => null)) as null | {
        message?: string;
        ok?: boolean;
      };

      if (!response.ok || !result?.ok) {
        setError(result?.message ?? "인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }

      setMessage(result.message ?? "인증 메일을 보냈습니다. Mailpit에서 최신 메일 링크를 열어 인증을 완료하세요.");
    } catch {
      setError("인증 메일 요청 중 네트워크 오류가 발생했습니다. 로컬 Supabase가 실행 중인지 확인해주세요.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestLoginEmail();
  }

  function handleEmailKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void requestLoginEmail();
  }

  return (
    <form action="/auth/otp" className="auth-card" method="post" onSubmit={handleSubmit} noValidate>
      <input name="next" type="hidden" value={nextPath} />
      <div className="auth-icon">
        <Mail size={20} />
      </div>
      <div>
        <h1>QualiFlow 로그인</h1>
        <p>Supabase Auth로 이메일 인증 링크를 받아 로컬 DB 연결 상태를 확인합니다.</p>
      </div>

      <label className="field">
        <span>이메일</span>
        <input
          aria-invalid={error ? "true" : "false"}
          autoComplete="email"
          inputMode="email"
          name="email"
          onKeyDown={handleEmailKeyDown}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="operator@company.com"
          type="email"
          value={email}
        />
      </label>

      {error ? <p className="field-message error">{error}</p> : null}
      {message ? <p className="field-message success">{message}</p> : null}
      <p className="field-message hint">
        로컬 Supabase 인증 메일은 실제 메일함이 아니라{" "}
        <a href="http://127.0.0.1:54324" rel="noreferrer" target="_blank">
          Mailpit
        </a>
        에서 확인합니다.
      </p>

      <button className="primary-button" disabled={isSending} type="submit">
        {isSending ? "메일 발송 중..." : "인증 메일 받기"}
      </button>
    </form>
  );
}
