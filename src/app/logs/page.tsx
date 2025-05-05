'use client';

import React from 'react';
import LogViewer from '../../components/LogViewer';

const LogViewerPage: React.FC = () => {
  return (
    <div style={{ 
      padding: '20px',
      maxWidth: '1200px', 
      margin: '0 auto',
      height: 'calc(100vh - 40px)'
    }}>
      <h1 style={{ marginBottom: '20px', color: '#333' }}>Agent Debug Logs</h1>
      <div style={{ height: 'calc(100% - 60px)' }}>
        <LogViewer 
          refreshInterval={3000} 
          maxLines={500}
        />
      </div>
    </div>
  );
};

export default LogViewerPage;