import React from 'react';

interface LogFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

interface LogViewerControlsProps {
  logFiles: LogFile[];
  selectedFile: string | null;
  filter: string;
  loading: boolean;
  autoRefresh: boolean;
  onFilterChange: (filter: string) => void;
  onFileChange: (file: string) => void;
  onRefresh: () => void;
  onAutoRefreshToggle: () => void;
}

const LogViewerControls: React.FC<LogViewerControlsProps> = ({
  logFiles,
  selectedFile,
  filter,
  loading,
  autoRefresh,
  onFilterChange,
  onFileChange,
  onRefresh,
  onAutoRefreshToggle,
}) => {
  return (
    <div className="flex flex-wrap gap-2 p-3 bg-gray-800 border-b border-gray-700">
      <div className="flex items-center gap-2">
        <label htmlFor="logFile" className="text-gray-300">Log File:</label>
        <select 
          id="logFile" 
          value={selectedFile || ''}
          onChange={(e) => onFileChange(e.target.value)}
          className="p-1.5 rounded bg-gray-700 text-gray-200 border border-gray-600"
        >
          {logFiles.map((file) => (
            <option key={file.name} value={file.name}>
              {file.name} ({(file.size / 1024).toFixed(2)} KB)
            </option>
          ))}
        </select>
      </div>
      
      <div className="flex items-center gap-2 flex-1">
        <input
          type="text"
          placeholder="Filter logs..."
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          className="flex-1 p-1.5 rounded bg-gray-700 text-gray-200 border border-gray-600"
        />
        <button 
          onClick={onRefresh} 
          disabled={loading}
          className={`p-1.5 rounded ${loading ? 'bg-gray-600 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
        >
          {loading ? '⟳ Loading...' : '⟳ Refresh'}
        </button>
        <label className="flex items-center gap-1 text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={onAutoRefreshToggle}
            className="rounded"
          />
          Auto-refresh
        </label>
      </div>
    </div>
  );
};

export default LogViewerControls;