import fs from 'fs';
import path from 'path';
import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

// Create logs directory if it doesn't exist
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Define log file paths
const logFilePath = path.join(logDir, 'agent-debug.log');
const logRotationSize = 150000; // KB

// Custom timestamp function for file logs
const formatTimestamp = () => {
  const now = new Date();
  return `,"time":"${now.toISOString()}"`;
};

// Setup multistream to log to both console and file
const streams = [
  // Console output with pretty printing in development
  {
    stream: isDevelopment
      ? pino.transport({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        })
      : process.stdout,
  },
  // File output with rotation and readable timestamps
  {
    level: 'debug',
    stream: pino.destination({
      dest: logFilePath,
      append: true,
      sync: false, // Use async for better performance
      mkdir: true, // Create directory if needed
    }),
    // Custom serializer for file output only
    serializers: {
      time: (time: Date) => new Date(time).toISOString(),
    }
  },
];

// Create the logger with both outputs
const logger = pino(
  {
    level: isDevelopment ? 'debug' : 'info',
    timestamp: formatTimestamp, // Use our custom timestamp formatter
  },
  pino.multistream(streams)
);

// Store original methods
const originalInfo = logger.info;
const originalDebug = logger.debug;
const originalWarn = logger.warn;
const originalError = logger.error;

// Check file size and rotate if needed
const checkRotation = () => {
  try {
    if (fs.existsSync(logFilePath)) {
      const stats = fs.statSync(logFilePath);
      const fileSizeInKB = stats.size / 1024;
      if (fileSizeInKB > logRotationSize) {
        // Rotate the log file
        const backupPath = path.join(logDir, `agent-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
        fs.renameSync(logFilePath, backupPath);
        
        // Create new stream for the main log file
        const fileStream = streams[1].stream;
        if (fileStream && typeof fileStream.end === 'function') {
          fileStream.end();
        }
        streams[1].stream = pino.destination({
          dest: logFilePath,
          append: true,
          sync: false,
          mkdir: true,
        });
        
        // Notify about rotation
        logger.info(`Log file rotated. Previous logs moved to ${backupPath}`);
      }
    }
  } catch (err) {
    console.error('Error checking log rotation:', err);
  }
};

// Replace the logger methods with wrapped versions
// Using 'any' type to avoid complex Pino typing issues
// This is a pragmatic choice for this specific logging enhancement
const wrapLogMethod = (original: any): any => {
  return function(this: any, ...args: any[]): any {
    checkRotation();
    return original.apply(this, args);
  };
};

// Apply the wrappers
logger.info = wrapLogMethod(originalInfo);
logger.debug = wrapLogMethod(originalDebug);
logger.warn = wrapLogMethod(originalWarn);
logger.error = wrapLogMethod(originalError);

export { logFilePath };
export default logger;
