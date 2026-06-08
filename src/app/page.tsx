import { MessageSquare } from "lucide-react";

export default function HomePage() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <span className="brand-title">Messenger Lab</span>
            <span className="brand-caption">Buyer CRM module</span>
          </div>
        </div>

        <nav className="nav-section" aria-label="Workspace">
          <div className="nav-label">Workspace</div>
          <button className="nav-item active" type="button">
            <MessageSquare size={16} />
            <span>메신저</span>
          </button>
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1 className="page-title">메신저</h1>
            <p className="caption">대화 목록, 메시지 타임라인, 답변 초안을 이곳에 한 단계씩 쌓습니다.</p>
          </div>
          <span className="status-pill">00 Scaffold</span>
        </header>

        <section className="messenger-empty">
          <div className="empty-icon">
            <MessageSquare size={24} />
          </div>
          <h2>메신저 기능을 시작할 준비가 되었습니다</h2>
          <p>
            아직 thread, message, buyer context는 없습니다. 다음 단계에서 메시지 모델부터 작게 추가합니다.
          </p>
        </section>
      </main>
    </div>
  );
}
