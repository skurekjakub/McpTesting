import { useState, useEffect, useCallback } from 'react';
import { LogEntryData } from '../components/LogEntryRow';

export interface LogFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

interface UseLogDataProps {
  refreshInterval?: number;
  maxLines?: number;
  initialFilter?: string;
}

/**
 * Custom hook for managing log data and operations
 * Separates data fetching and state management from presentation concerns
 */
export function useLogData({ 
  refreshInterval = 5000, 
  maxLines = 100, 
  initialFilter = '' 
}: UseLogDataProps) {
  const [logs, setLogs] = useState<LogEntryData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(initialFilter);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  
  // Fetch log files list
  const fetchLogFiles = useCallback(async () => {
    try {
      const response = await fetch('/api/logs', {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch log files: ${response.status}`);
      }
      
      const data = await response.json();
      setLogFiles(data.files || []);
      
      // Set default selected file if none is selected
      if (!selectedFile && data.files && data.files.length > 0) {
        setSelectedFile(data.files[0].name);
      }
    } catch (err) {
      setError(`Error fetching log files: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [selectedFile]);
  
  // Fetch logs from the selected file or current log
  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      
      let url = `/api/logs?lines=${maxLines}`;
      if (filter) {
        url += `&filter=${encodeURIComponent(filter)}`;
      }
      
      // If a specific file is selected (not the current log file)
      if (selectedFile && selectedFile !== 'agent-debug.log') {
        const response = await fetch('/api/logs', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            file: selectedFile
          }),
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch logs: ${response.status}`);
        }
        
        const data = await response.json();
        setLogs(data.logs || []);
      } else {
        // Fetch current logs
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch logs: ${response.status}`);
        }
        
        const data = await response.json();
        setLogs(data.logs || []);
      }
      
      setError(null);
    } catch (err) {
      setError(`Error fetching logs: ${err instanceof Error ? err.message : String(err)}`);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [filter, maxLines, selectedFile]);

  // Handle filter change
  const handleFilterChange = (newFilter: string) => {
    setFilter(newFilter);
  };
  
  // Handle file selection
  const handleFileChange = (file: string) => {
    setSelectedFile(file);
  };

  // Toggle auto-refresh
  const toggleAutoRefresh = () => {
    setAutoRefresh(prev => !prev);
  };
  
  // Initial fetch and setup auto-refresh
  useEffect(() => {
    fetchLogFiles();
    fetchLogs();
    
    let intervalId: NodeJS.Timeout | null = null;
    
    if (autoRefresh) {
      intervalId = setInterval(() => {
        fetchLogs();
        // Only refresh file list occasionally
        if (Math.random() < 0.2) fetchLogFiles();
      }, refreshInterval);
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [autoRefresh, fetchLogFiles, fetchLogs, refreshInterval]);
  
  // Reload logs when filter or selected file changes
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs, filter, selectedFile]);

  return {
    logs,
    loading,
    error,
    filter,
    autoRefresh,
    logFiles,
    selectedFile,
    actions: {
      fetchLogs,
      fetchLogFiles,
      handleFilterChange,
      handleFileChange,
      toggleAutoRefresh
    }
  };
}