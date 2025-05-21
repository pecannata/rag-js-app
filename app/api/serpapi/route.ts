import { NextRequest, NextResponse } from 'next/server';

// Define SerpAPI URL and parameters
const SERPAPI_BASE_URL = 'https://serpapi.com/search';

// Define types for SerpAPI response
interface SerpApiResponse {
  search_metadata?: {
    id: string;
    status: string;
    created_at: string;
  };
  search_parameters?: {
    engine: string;
    q: string;
  };
  error?: string;
  [key: string]: any; // For other potential fields
}

// GET handler for SerpAPI route
export async function GET(request: NextRequest) {
  try {
    console.log('\n================================================');
    console.log('======== SERPAPI ROUTE REQUEST STARTED =========');
    console.log('================================================\n');
    
    // Get query from URL params if provided, otherwise use the hardcoded query.
    const { searchParams } = new URL(request.url);
    
    // If a query parameter is provided, use it. Otherwise, use the hardcoded query from Chat.tsx
    const query = searchParams.get('query');
    
    // Require a query parameter - do not use a hardcoded fallback
    if (!query || query.trim() === '') {
      console.error('ERROR: No search query provided');
      return NextResponse.json(
        { error: 'No search query provided. Please include a "query" parameter in your request.' },
        { status: 400 }
      );
    }
    
    // Get API key from query parameters or environment variable
    const apiKey = searchParams.get('api_key') || process.env.SERPAPI_KEY;
    
    // Check if organic results should be included (default to false)
    const includeOrganic = searchParams.get('includeOrganic') === 'true';
    
    console.log('📝 Request Information:');
    console.log(`   • Query: "${query}"`);
    console.log(`   • API Key Present: ${apiKey ? 'Yes' : 'No'}`);
    console.log(`   • Include Organic Results: ${includeOrganic ? 'Yes' : 'No'}`);
    console.log(`   • Request URL: ${request.url}`);
    console.log(`   • Request Method: ${request.method}`);
    console.log(`   • User Agent: ${request.headers.get('user-agent')}`);
    console.log(`   • Timestamp: ${new Date().toISOString()}`);
    console.log('');
    
    if (!apiKey) {
      console.error('❌ ERROR: No SerpAPI key provided');
      return NextResponse.json(
        { error: 'No SerpAPI key provided. Please add your SerpAPI key to query parameters or environment variables.' },
        { status: 400 }
      );
    }

    // Construct SerpAPI URL with parameters
    const params = new URLSearchParams({
      q: query,
      api_key: apiKey,
      engine: 'google'
    });

    const serpApiUrl = `${SERPAPI_BASE_URL}?${params.toString()}`;
    
    console.log('🔍 Sending request to SerpAPI:');
    console.log(`   • URL: ${SERPAPI_BASE_URL}`);
    console.log(`   • Engine: google`);
    console.log(`   • Query: "${query}"`);
    console.log(`   • API Key: ${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`);
    console.log('');
    
    // Send request to SerpAPI
    console.log('⏳ Waiting for SerpAPI response...');
    const startTime = Date.now();
    const response = await fetch(serpApiUrl);
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    console.log(`✅ Response received in ${responseTime}ms`);
    console.log(`   • Status: ${response.status} ${response.statusText}`);
    console.log('');
    
    const data: SerpApiResponse = await response.json();
    
    if (response.status !== 200) {
      console.error('❌ SerpAPI request failed:', data.error || response.statusText);
      return NextResponse.json(
        { 
          error: 'SerpAPI request failed', 
          details: data.error || response.statusText 
        },
        { status: response.status }
      );
    }
    
    // Filter out organic_results if not requested
    if (!includeOrganic && data.organic_results) {
      console.log('🔍 Excluding organic_results from response as requested');
      delete data.organic_results;
    }
    
    // Print JSON results to terminal
    console.log('\n==============================================================');
    console.log('===================== SERPAPI RESULTS =======================');
    console.log('==============================================================\n');
    
    // Pretty print the entire JSON response
    console.log('📋 Complete SerpAPI JSON Response:');
    console.log(JSON.stringify(data, null, 2));
    
    console.log('\n==============================================================');
    console.log('================= END OF SERPAPI RESULTS ====================');
    console.log('==============================================================\n');
    
    // Return successful response
    console.log('✅ SerpAPI query results processed successfully');
    console.log('🔄 Sending response to client');
    return NextResponse.json(data);
  } catch (error) {
    console.error('\n❌ ERROR in SerpAPI route:');
    console.error(error);
    
    // Print full error stack if available
    if (error instanceof Error && error.stack) {
      console.error('\n📚 Error Stack:');
      console.error(error.stack);
    }
    
    console.log('\n==============================================================');
    console.log('================= SERPAPI REQUEST FAILED ====================');
    console.log('==============================================================\n');
    
    return NextResponse.json(
      { 
        error: 'An error occurred while processing your request',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
