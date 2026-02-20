export default function NotConfigured() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8 max-w-md text-center">
        <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-yellow-600 text-xl">!</span>
        </div>
        <h2 className="text-lg font-semibold text-slate-800 mb-2">Airtable Not Configured</h2>
        <p className="text-sm text-slate-600 mb-4">
          Create a <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">.env</code> file
          in the dashboard directory with your Airtable credentials:
        </p>
        <div className="bg-slate-900 rounded-md p-3 text-left text-xs text-slate-300 font-mono">
          <div>VITE_AIRTABLE_PAT=pat...</div>
          <div>VITE_AIRTABLE_BASE_ID=app...</div>
        </div>
      </div>
    </div>
  );
}
