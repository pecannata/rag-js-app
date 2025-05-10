import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export async function GET(request: NextRequest) {
  try {
    // Get the SQL query from the request URL search parameters
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    
    // Check if query parameter is provided
    if (!query) {
      console.warn('No SQL query provided in request');
      return NextResponse.json({ 
        error: 'No SQL query provided' 
      }, { status: 400 });
    }
    
    // Construct the full path to the script
    // Using __dirname would be ideal, but it's not available in ESM
    // Instead, we'll use the cwd and navigate relative to it
    const scriptPath = path.resolve(process.cwd(), '../SQLclScript.sh');
    
    // Check if the script exists
    if (!fs.existsSync(scriptPath)) {
      console.error(`Script not found at path: ${scriptPath}`);
      return NextResponse.json({ error: 'SQL script not found' }, { status: 404 });
    }

    // Execute the bash script with the query
    // Properly escape the path and arguments
    const command = `"${scriptPath}" "${query}"`;
    console.log(`Executing command: ${command}`);
    
    const result = execSync(command, { 
      encoding: 'utf-8',
      // Increase buffer size to handle large result sets
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    });
    
    // Parse the JSON result
    // The SQL script might return some additional output before the JSON
    // We need to try to extract just the JSON part
    let jsonResult;
    try {
      // Try to parse the entire output as JSON
      jsonResult = JSON.parse(result);
    } catch (e) {
      // If that fails, try to find JSON in the output
      const jsonMatch = result.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (jsonMatch) {
        jsonResult = JSON.parse(jsonMatch[0]);
      } else {
        // If we can't parse JSON, return the raw output
        console.log('Failed to parse JSON from output:', result);
        return NextResponse.json({ 
          raw: result,
          error: 'Failed to parse JSON from output'
        }, { status: 500 });
      }
    }

    console.log('SQL query results:', JSON.stringify(jsonResult, null, 2));
    
    // Return the JSON result
    return NextResponse.json(jsonResult);
  } catch (error) {
    console.error('Error executing SQL query:', error);
    return NextResponse.json({ 
      error: 'An error occurred while executing the SQL query',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

