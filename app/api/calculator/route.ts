import { NextRequest, NextResponse } from 'next/server';

// Simple calculator API that processes calculation requests
export async function POST(request: NextRequest) {
  try {
    // Parse the request body
    const body = await request.json();
    const { expression } = body;
    
    if (!expression) {
      return NextResponse.json(
        { error: 'No expression provided' },
        { status: 400 }
      );
    }
    
    console.log(`Calculator API received expression: ${expression}`);
    
    // The actual calculation will be handled by LangChain's calculator tool
    // This endpoint is just a proxy to maintain the API architecture
    
    return NextResponse.json({
      expression,
      success: true
    });
  } catch (error) {
    console.error('Error in calculator API route:', error);
    
    return NextResponse.json(
      { 
        error: 'An error occurred while processing your calculation request',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
