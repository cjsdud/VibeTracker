import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateProject } from '../api/hooks.js';

/** 사이드바 "+ 새 프로젝트"에서 진입. 생성 후 해당 프로젝트를 선택하고 온보딩으로 보낸다. */
export function NewProjectPage({ onCreated }: { onCreated: (projectId: string) => void }) {
  const navigate = useNavigate();
  const createProject = useCreateProject();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <h1>새 프로젝트</h1>
        <p>Claude Code로 작업할 실제 프로젝트를 등록하세요.</p>
        <div className="field">
          <label>프로젝트 이름</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 내 사이드 프로젝트"
          />
        </div>
        <div className="field">
          <label>목표 (선택)</label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            placeholder="이 프로젝트가 사용자에게 주는 가치 한두 문장"
          />
        </div>
        <button
          className="btn primary"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={!name.trim() || createProject.isPending}
          onClick={() =>
            createProject.mutate(
              { name: name.trim(), goal: goal.trim() || undefined },
              {
                onSuccess: (data) => {
                  onCreated(data.project.id);
                  navigate('/onboarding');
                },
              },
            )
          }
        >
          {createProject.isPending ? '만드는 중…' : '프로젝트 만들기'}
        </button>
        {createProject.isError && (
          <div className="alert error" style={{ marginTop: 10 }}>
            {createProject.error.message}
          </div>
        )}
        <button
          className="btn"
          style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
          onClick={() => navigate('/')}
        >
          취소
        </button>
      </div>
    </div>
  );
}
