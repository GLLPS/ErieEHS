import { useState, useCallback } from 'react';
import { isConfigured } from './services/airtable';
import NotConfigured from './components/NotConfigured';
import ActionRequired from './pages/ActionRequired';
import WhatsNext from './pages/WhatsNext';
import ClientSnapshot from './pages/ClientSnapshot';
import TrainingMatrix from './pages/TrainingMatrix';
import PortfolioOverview from './pages/PortfolioOverview';

const TABS = [
  { id: 'action', label: 'Action Required', icon: '\u26A0\uFE0F' },
  { id: 'whats-next', label: "What's Next", icon: '\uD83D\uDCC5' },
  { id: 'client', label: 'Client Snapshot', icon: '\uD83C\uDFE2' },
  { id: 'training', label: 'Training Matrix', icon: '\uD83D\uDCCB' },
  { id: 'portfolio', label: 'Portfolio Overview', icon: '\uD83D\uDCCA' },
];

const TAB_COLORS = {
  action: 'border-red-500 text-red-700 bg-red-50',
  'whats-next': 'border-orange-500 text-orange-700 bg-orange-50',
  client: 'border-blue-500 text-blue-700 bg-blue-50',
  training: 'border-purple-500 text-purple-700 bg-purple-50',
  portfolio: 'border-slate-500 text-slate-700 bg-slate-50',
};

export default function App() {
  const [activeTab, setActiveTab] = useState('action');
  const [selectedClientId, setSelectedClientId] = useState(null);

  const handleClientSelect = useCallback((clientId) => {
    setSelectedClientId(clientId);
    setActiveTab('client');
  }, []);

  if (!isConfigured()) {
    return <NotConfigured />;
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <header className="bg-[#1E293B] text-white shadow-lg">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-500 rounded flex items-center justify-center text-sm font-bold">
              GLE
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">EHS Management Hub</h1>
              <p className="text-[10px] text-slate-400 leading-tight">Great Lakes Environmental</p>
            </div>
          </div>
          <div className="text-xs text-slate-400">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4">
          <div className="flex gap-1 -mb-px">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                    ${isActive
                      ? TAB_COLORS[tab.id]
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                    }
                  `}
                >
                  <span className="mr-1.5">{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto p-4">
        {activeTab === 'action' && (
          <ActionRequired onClientSelect={handleClientSelect} />
        )}
        {activeTab === 'whats-next' && (
          <WhatsNext onClientSelect={handleClientSelect} />
        )}
        {activeTab === 'client' && (
          <ClientSnapshot
            clientId={selectedClientId}
            onBack={() => setActiveTab('action')}
          />
        )}
        {activeTab === 'training' && (
          <TrainingMatrix />
        )}
        {activeTab === 'portfolio' && (
          <PortfolioOverview />
        )}
      </main>
    </div>
  );
}
