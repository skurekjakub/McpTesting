import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { logFilePath } from '../../../server/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const url = new URL(request.url);
    const params = url.searchParams;
    const lines = parseInt(params.get('lines') || '100', 10);
    const filter = params.get('filter') || '';
    
    // Check if the log file exists
    if (!fs.existsSync(logFilePath)) {
      return NextResponse.json({ 
        error: 'Log file not found',
        logs: [] 
      }, { status: 404 });
    }

    // Read the log file
    const content = fs.readFileSync(logFilePath, 'utf-8');
    
    // Split by lines and take the last N lines
    let logLines = content.trim().split('\n');
    
    // Apply filter if provided
    if (filter) {
      const lowerFilter = filter.toLowerCase();
      logLines = logLines.filter(line => line.toLowerCase().includes(lowerFilter));
    }
    
    // Get the last N lines
    logLines = logLines.slice(-lines);
    
    // Parse each line as JSON if possible
    const logs = logLines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return { msg: line, level: 'unknown', time: new Date().toISOString() };
      }
    });

    // Return the logs
    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Error retrieving logs:', error);
    return NextResponse.json({ 
      error: 'Failed to retrieve logs',
      message: error instanceof Error ? error.message : String(error),
      logs: []
    }, { status: 500 });
  }
}

// API endpoint to list available log files
export async function POST(request: NextRequest) {
  try {
    const logDir = path.dirname(logFilePath);
    
    if (!fs.existsSync(logDir)) {
      return NextResponse.json({ 
        error: 'Log directory not found', 
        files: [] 
      }, { status: 404 });
    }
    
    // List log files in the directory
    const files = fs.readdirSync(logDir)
      .filter(file => file.endsWith('.log'))
      .map(file => ({
        name: file,
        path: path.join(logDir, file),
        size: fs.statSync(path.join(logDir, file)).size,
        modified: fs.statSync(path.join(logDir, file)).mtime
      }))
      .sort((a, b) => b.modified.getTime() - a.modified.getTime());
      
    return NextResponse.json({ files });
  } catch (error) {
    console.error('Error retrieving log file list:', error);
    return NextResponse.json({ 
      error: 'Failed to retrieve log file list',
      message: error instanceof Error ? error.message : String(error),
      files: []
    }, { status: 500 });
  }
}

// API endpoint to fetch a specific log file content
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { file } = body;
    
    if (!file) {
      return NextResponse.json({
        error: 'No file specified',
        logs: []
      }, { status: 400 });
    }
    
    // Ensure the requested file is in the log directory for security
    const logDir = path.dirname(logFilePath);
    const requestedFilePath = path.join(logDir, path.basename(file));
    
    if (!fs.existsSync(requestedFilePath) || !requestedFilePath.startsWith(logDir)) {
      return NextResponse.json({ 
        error: 'Log file not found or access denied',
        logs: [] 
      }, { status: 404 });
    }
    
    // Read the log file
    const content = fs.readFileSync(requestedFilePath, 'utf-8');
    
    // Split by lines
    let logLines = content.trim().split('\n');
    
    // Parse each line as JSON if possible
    const logs = logLines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return { msg: line, level: 'unknown', time: new Date().toISOString() };
      }
    });

    // Return the logs
    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Error retrieving specific log file:', error);
    return NextResponse.json({ 
      error: 'Failed to retrieve log content',
      message: error instanceof Error ? error.message : String(error),
      logs: []
    }, { status: 500 });
  }
}