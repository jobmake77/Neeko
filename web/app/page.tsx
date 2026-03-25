import { PersonaCard, NewPersonaCard } from '@/components/persona-card';
import { Search } from 'lucide-react';

async function getPersonas() {
  try {
    const res = await fetch('http://localhost:3000/api/personas', { cache: 'no-store' });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function Home() {
  const personas = await getPersonas();

  return (
    <div className="p-8 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-[oklch(0.15_0_0)]">Persona</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-white border border-[oklch(0.91_0.002_90)] px-1 py-1">
            <button className="px-3 py-1 rounded-md text-[13px] bg-[oklch(0.94_0.05_142)] text-[oklch(0.3_0.12_142)] font-medium">
              我的 Persona
              {personas.length > 0 && (
                <span className="ml-1.5 bg-[oklch(0.72_0.18_142)] text-white text-[11px] px-1.5 py-0.5 rounded-full">
                  {personas.length}
                </span>
              )}
            </button>
            <button className="px-3 py-1 rounded-md text-[13px] text-[oklch(0.5_0_0)] hover:bg-[oklch(0.97_0_0)] transition-colors">
              任务衍生
            </button>
          </div>

          <div className="flex items-center gap-2 bg-white border border-[oklch(0.91_0.002_90)] rounded-lg px-3 py-2">
            <Search className="w-3.5 h-3.5 text-[oklch(0.65_0_0)]" />
            <input
              placeholder="搜索 Persona..."
              className="text-[13px] bg-transparent outline-none w-36 placeholder:text-[oklch(0.7_0_0)]"
            />
          </div>
        </div>
      </div>

      <p className="text-[14px] text-[oklch(0.55_0_0)] mb-8">
        管理你的数字孪生，创建新 Persona 并开始对话。
      </p>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <NewPersonaCard />

        {personas.map((persona: Parameters<typeof PersonaCard>[0]['persona']) => (
          <PersonaCard key={persona.id} persona={persona} />
        ))}

        {personas.length === 0 && (
          <div className="col-span-3 flex flex-col items-center justify-center py-20 text-center">
            <div className="text-5xl mb-4">🧬</div>
            <p className="text-[15px] font-medium text-[oklch(0.4_0_0)]">还没有 Persona</p>
            <p className="text-[13px] text-[oklch(0.6_0_0)] mt-1">
              点击「新建 Persona」开始蒸馏你的第一个数字孪生
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
