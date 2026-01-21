// src/app/admin/plugins/Toggle.tsx
'use client';

import { updatePluginStatus } from "@/lib/actions/plugins";

export default function PluginToggle({ pluginId, isActive }: { pluginId: string, isActive: boolean }) {
  return (
    <div className="flex items-center justify-between p-4 border rounded-lg bg-white">
      <div>
        <h3 className="font-medium capitalize">{pluginId.replace('-', ' ')}</h3>
      </div>
      <button 
        onClick={() => updatePluginStatus(pluginId, !isActive)}
        className={`px-4 py-2 rounded ${isActive ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}
      >
        {isActive ? 'Deactivate' : 'Activate'}
      </button>
    </div>
  );
}
