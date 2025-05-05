import React from 'react';

export interface LogEntryData {
  time?: string;
  level?: string | number | any;
  msg?: string | any;
  [key: string]: any;
}

interface LogEntryRowProps {
  log: LogEntryData;
}

/**
 * Component responsible for rendering a single log entry row
 * with color-coding based on log level for enhanced agent observability
 */
const LogEntryRow: React.FC<LogEntryRowProps> = ({ log }) => {
  // Format timestamp to readable format
  const formatTime = (timeStr?: string): string => {
    if (!timeStr) return 'Unknown';
    try {
      const date = new Date(timeStr);
      return date.toLocaleTimeString();
    } catch (e) {
      return timeStr;
    }
  };
  
  // Safe string conversion for any value
  const safeString = (value: any): string => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  // Normalize log level to a standard string representation
  const normalizeLevel = (level?: string | number | any): string => {
    if (level === undefined || level === null) return 'unknown';
    
    // Handle numeric log levels according to standard severity levels
    if (typeof level === 'number') {
      // Standard numeric log levels (typical in many logging systems)
      // 50: CRITICAL/FATAL, 40: ERROR, 30: WARNING, 20: INFO, 10: DEBUG
      if (level >= 50) return 'error';
      if (level >= 40) return 'warn';
      if (level >= 30) return 'info';
      if (level >= 20) return 'debug';
      if (level >= 10) return 'debug';
      return 'debug';
    }
    
    if (typeof level === 'string') {
      return level.toLowerCase();
    }
    
    return 'unknown';
  };

  // Format the log level for display
  const formatLevel = (level?: string | number | any): string => {
    if (level === undefined || level === null) return 'UNKNOWN';
    
    // For numeric levels, show both number and mapped name
    if (typeof level === 'number') {
      const mappedLevel = normalizeLevel(level);
      return `${level} (${mappedLevel.toUpperCase()})`;
    }
    
    return typeof level === 'string' 
      ? level.toUpperCase() 
      : safeString(level).toUpperCase() || 'UNKNOWN';
  };

  // Get log level base classes (border only)
  const getBorderClass = (level?: string | number | any): string => {
    const normalizedLevel = normalizeLevel(level);
    
    switch (normalizedLevel) {
      case 'error':
        return 'border-l-4 border-red-500';
      case 'warn':
        return 'border-l-4 border-yellow-500';
      case 'info':
        return 'border-l-4 border-blue-500';
      case 'debug':
        return 'border-l-4 border-gray-500';
      default:
        return 'border-l-4 border-gray-400';
    }
  };

  // Get background class based on normalized log level
  const getBackgroundClass = (level?: string | number | any): string => {
    const normalizedLevel = normalizeLevel(level);
    
    switch (normalizedLevel) {
      case 'error':
        return 'bg-red-500/10 hover:bg-red-500/20';
      case 'warn':
        return 'bg-yellow-500/10 hover:bg-yellow-500/20';
      case 'info':
        return 'bg-blue-500/10 hover:bg-blue-500/20';
      case 'debug':
        return 'bg-gray-500/5 hover:bg-gray-500/10';
      default:
        return 'bg-gray-600/5 hover:bg-gray-600/10'; // Default background for unknown levels
    }
  };

  // Get log level text color
  const getLevelTextClass = (level?: string | number | any): string => {
    const normalizedLevel = normalizeLevel(level);
    
    switch (normalizedLevel) {
      case 'error':
        return 'text-red-400 font-semibold';
      case 'warn':
        return 'text-yellow-400 font-semibold';
      case 'info':
        return 'text-blue-400 font-semibold';
      case 'debug':
        return 'text-gray-400 font-semibold';
      default:
        return 'text-gray-300 font-semibold'; // More visible default
    }
  };

  // Extract additional context fields (everything except standard fields)
  const contextFields = Object.entries(log)
    .filter(([key]) => !['time', 'level', 'msg', 'pid', 'hostname'].includes(key));

  const normalizedLevel = normalizeLevel(log.level);

  return (
    <tr 
      className={`
        border-b border-gray-700 
        ${getBorderClass(log.level)} 
        ${getBackgroundClass(log.level)} 
        transition-all duration-200
      `}
      data-level={normalizedLevel}
    >
      <td className="p-2 text-gray-400 whitespace-nowrap w-24">
        {formatTime(log.time)}
      </td>
      <td className={`p-2 w-20 ${getLevelTextClass(log.level)}`}>
        {formatLevel(log.level)}
      </td>
      <td className="p-2 break-words">
        <div>{safeString(log.msg)}</div>
        {/* Show additional context if available */}
        {contextFields.map(([key, value]) => (
          <div key={key} className="mt-1 text-sm text-gray-400">
            <span className="text-blue-400 mr-1">{key}:</span>
            <span className="text-green-300">
              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </span>
          </div>
        ))}
      </td>
    </tr>
  );
};

export default LogEntryRow;