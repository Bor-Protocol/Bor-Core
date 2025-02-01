# BorpClient Task Processing System Documentation

## Overview
Recent updates to the BorpClient introduce a comprehensive task processing system with detailed timing tracking, cycle management, and extensive logging capabilities.

## Key Components

### TaskHistoryEntry Interface
typescript
interface TaskHistoryEntry {
cycleId: number;
startTime: Date;
endTime?: Date;
taskPlan: string[];
completedTasks: {
name: string;
startTime: Date;
endTime: Date;
duration: number; // milliseconds
}[];
failedTasks: {
name: string;
startTime: Date;
endTime: Date;
duration: number;
error?: string;
}[];
status: 'in-progress' | 'completed' | 'failed';
duration?: number; // total cycle duration in milliseconds
}

## Core Features

### 1. Task Processing System
- Sequential task execution instead of interval-based
- Each task is processed after the previous one completes
- Configurable delays between tasks (2000ms) and cycles (3000ms)

### 2. Cycle Management
- Tracks multiple cycles of task execution
- Each cycle has its own task plan generated dynamically
- Maximum of 100 cycles stored in history (rolling window)

### 3. Time Tracking
- Detailed timing information for:
  - Overall process duration
  - Individual cycle duration
  - Individual task duration
- All timestamps formatted using `toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'long' })`

### 4. Statistics and Analytics
Several helper methods provide insights into task execution:

#### `calculateAverageCycleDuration()`
- Calculates the average duration of all completed cycles
- Returns duration in milliseconds

#### `calculateTaskSuccessRates()`
- Computes success rates for each task type
- Returns object with success count, failure count, and success rate percentage

#### `identifyMostTimeConsumingTasks()`
- Analyzes task execution times
- Returns sorted array of tasks with:
  - Average duration
  - Total duration
  - Execution count

## Logging System

### 1. Process Logging
- Start and end of overall process
- Formatted timestamps
- Total duration

### 2. Cycle Logging
- Cycle start/end times
- Task plan
- Completed/failed tasks
- Duration statistics

### 3. Task Logging
- Individual task execution times
- Success/failure status
- Error messages for failed tasks
- Duration measurements

## Example Log Output
typescript
interface TaskHistoryEntry {
cycleId: number;
startTime: Date;
endTime?: Date;
taskPlan: string[];
completedTasks: {
name: string;
startTime: Date;
endTime: Date;
duration: number; // milliseconds
}[];
failedTasks: {
name: string;
startTime: Date;
endTime: Date;
duration: number;
error?: string;
}[];
status: 'in-progress' | 'completed' | 'failed';
duration?: number; // total cycle duration in milliseconds
}

## Error Handling
- Comprehensive error catching at multiple levels:
  - Individual task level
  - Cycle level
  - Overall process level
- Failed tasks are recorded with error messages
- System continues processing despite individual task failures

## Memory Management
- Rolling window of 100 cycles
- Older cycles are automatically removed
- Prevents memory leaks from long-running processes

## Usage
const client = new BorpClient(runtime);
client.startTaskProcessing().catch(error => {
aiKhwarizmiLogger.error("Error starting task processing:", error);
});

## Best Practices
1. Monitor the logs for task execution patterns
2. Review task success rates to identify problematic tasks
3. Use timing information to optimize task execution
4. Check error patterns in failed tasks
5. Monitor average cycle duration for performance trends