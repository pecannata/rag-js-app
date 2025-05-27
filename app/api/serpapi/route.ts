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
  knowledge_graph?: {
    title?: string;
    type?: string;
    description?: string;
    [key: string]: any;
  };
  answer_box?: {
    title?: string;
    answer?: string;
    snippet?: string;
    [key: string]: any;
  };
  organic_results?: Array<{
    position?: number;
    title?: string;
    link?: string;
    snippet?: string;
    [key: string]: any;
  }>;
  related_questions?: Array<{
    question?: string;
    answer?: string;
    [key: string]: any;
  }>;
  top_stories?: Array<{
    title?: string;
    link?: string;
    source?: string;
    [key: string]: any;
  }>;
  [key: string]: any; // For other potential fields
}

/**
 * Filtered response containing only essential data for LLM consumption
 * 
 * This structure contains only the most relevant fields from the SerpAPI response
 * to minimize token usage when passing to an LLM.
 */
interface FilteredSerpApiResponse {
  search_parameters?: {
    engine: string;
    q: string;
  };
  knowledge_graph?: {
    title?: string;
    type?: string;
    description?: string;
  };
  answer_box?: {
    title?: string;
    answer?: string;
    snippet?: string;
  };
  organic_results?: Array<{
    title: string;
    link: string;
    snippet?: string;
  }>;
  related_questions?: Array<{
    question: string;
    answer?: string;
  }>;
  top_stories?: Array<{
    title: string;
    link: string;
    source?: string;
  }>;
  error?: string;
}

/**
 * Filters a SerpAPI response to extract only the essential data needed for LLM consumption.
 * This reduces token usage by removing unnecessary fields and metadata.
 * 
 * @param data The full SerpAPI response
 * @param includeOrganic Whether to include organic search results
 * @returns A filtered version of the response with only essential data
 */
function filterSerpApiResponse(data: SerpApiResponse, includeOrganic: boolean): FilteredSerpApiResponse {
  try {
    const filteredResponse: FilteredSerpApiResponse = {};

    // Include search parameters (query info)
    if (data.search_parameters) {
      filteredResponse.search_parameters = {
        engine: data.search_parameters.engine,
        q: data.search_parameters.q
      };
    }

    // Include knowledge graph if available
    if (data.knowledge_graph) {
      filteredResponse.knowledge_graph = {
        title: data.knowledge_graph.title,
        type: data.knowledge_graph.type,
        description: data.knowledge_graph.description
      };
    }

    // Include answer box if available
    if (data.answer_box) {
      filteredResponse.answer_box = {
        title: data.answer_box.title,
        answer: data.answer_box.answer,
        snippet: data.answer_box.snippet
      };
    }

    // Include related questions if available
    if (data.related_questions && data.related_questions.length > 0) {
      filteredResponse.related_questions = data.related_questions.map(q => ({
        question: q.question || '',
        answer: q.answer
      }));
    }

    // Include top stories/news if available
    if (data.top_stories && data.top_stories.length > 0) {
      filteredResponse.top_stories = data.top_stories.map(story => ({
        title: story.title || '',
        link: story.link || '',
        source: story.source
      }));
    }

    // Include organic results if requested
    if (includeOrganic && data.organic_results && data.organic_results.length > 0) {
      filteredResponse.organic_results = data.organic_results.map(result => ({
        title: result.title || '',
        link: result.link || '',
        snippet: result.snippet
      }));
    }

    // Include error if present
    if (data.error) {
      filteredResponse.error = data.error;
    }

    return filteredResponse;
  } catch (error) {
    // Return original data with error flag if filtering fails
    return {
      ...data,
      error: `Error filtering response: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// GET handler for SerpAPI route
export async function GET(request: NextRequest) {
  try {
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
    
    // Check if response should be filtered for LLM consumption (default to false)
    const minimal = searchParams.get('minimal') === 'true';
    
    if (!apiKey) {
      console.error('ERROR: No SerpAPI key provided');
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
    
    // Send request to SerpAPI
    const startTime = Date.now();
    const response = await fetch(serpApiUrl);
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    const data: SerpApiResponse = await response.json();
    
    if (response.status !== 200) {
      console.error('SerpAPI request failed:', data.error || response.statusText);
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
      delete data.organic_results;
    }
    
    // Filter the response for LLM consumption if minimal=true
    let responseData = data;
    if (minimal) {
      try {
        responseData = filterSerpApiResponse(data, includeOrganic);
      } catch (filterError) {
        console.error('Error filtering response:', filterError);
        // Add an error note but still return data
        data.filter_error = `Failed to filter response: ${filterError instanceof Error ? filterError.message : String(filterError)}`;
        responseData = data;
      }
    }
    
    return NextResponse.json(responseData);
  } catch (error) {
    console.error('ERROR in SerpAPI route:', error);
    
    return NextResponse.json(
      { 
        error: 'An error occurred while processing your request',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
