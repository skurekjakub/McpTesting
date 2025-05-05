import React from 'react';
import LogEntryRow, { LogEntryData } from './LogEntryRow';

interface LogTableProps {
  logs: LogEntryData[];
  loading: boolean;
}

/**
 * Component responsible for displaying log entries in a table format
 * Displays most recent logs at the top for better agent monitoring
 */
const LogTable: React.FC<LogTableProps> = ({ logs, loading }) => {
  if (logs.length === 0) {
    return (
      <div className="py-5 text-center text-gray-500">
        {loading ? 'Loading logs...' : 'No logs found matching the criteria'}
      </div>
    );
  }

  // Create a reversed copy of logs to display newest entries at the top
  const reversedLogs = [...logs].reverse();

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className="p-2 text-left bg-gray-800 text-white sticky top-0 z-10">Time</th>
          <th className="p-2 text-left bg-gray-800 text-white sticky top-0 z-10">Level</th>
          <th className="p-2 text-left bg-gray-800 text-white sticky top-0 z-10">Message</th>
        </tr>
      </thead>
      <tbody>
        {reversedLogs.map((log, index) => (
          <LogEntryRow key={index} log={log} />
        ))}
      </tbody>
    </table>
  );
};

export default LogTable;