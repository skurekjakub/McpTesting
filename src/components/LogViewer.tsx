import React from 'react';
import LogViewerControls from './LogViewerControls';
import LogTable from './LogTable';
import { useLogData } from '../hooks/useLogData';

interface LogViewerProps {
  refreshInterval?: number;
  maxLines?: number; 
  initialFilter?: string;
}

/**
 * Main LogViewer component that orchestrates the log viewing experience
 * Delegates specific responsibilities to child components while
 * managing the overall state and lifecycle through hooks
 */
const LogViewer: React.FC<LogViewerProps> = ({
  refreshInterval = 5000,
  maxLines = 100,
  initialFilter = '',
}) => {
  // Use our custom hook to handle all data fetching and state management
  const { 
    logs, 
    loading, 
    error, 
    filter, 
    autoRefresh, 
    logFiles, 
    selectedFile,
    actions
  } = useLogData({ 
    refreshInterval, 
    maxLines, 
    initialFilter 
  });

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-200 font-mono rounded overflow-hidden">
      {/* Controls for file selection, filtering and refresh */}
      <LogViewerControls 
        logFiles={logFiles}
        selectedFile={selectedFile}
        filter={filter}
        loading={loading}
        autoRefresh={autoRefresh}
        onFilterChange={actions.handleFilterChange}
        onFileChange={actions.handleFileChange}
        onRefresh={actions.fetchLogs}
        onAutoRefreshToggle={actions.toggleAutoRefresh}
      />
      
      {/* Error display */}
      {error && <div className="p-3 bg-red-600 text-white rounded-sm m-2">{error}</div>}
      
      {/* Log entries display */}
      <div className="flex-1 overflow-y-auto">
        <LogTable logs={logs} loading={loading} />
      </div>
    </div>
  );
};

export default LogViewer;