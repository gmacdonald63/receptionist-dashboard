const RETELL_API_KEY = import.meta.env.VITE_RETELL_API_KEY;
const RETELL_API_BASE = 'https://api.retellai.com/v2';

export const retellService = {
  // Fetch calls, optionally filtered by agent_id
  async getCalls(limit = 100, agentId = null) {
    console.log('Calling Retell API...');
    console.log('API Key (first 10 chars):', RETELL_API_KEY?.substring(0, 10));
    console.log('API Base:', RETELL_API_BASE);
    console.log('Agent ID filter:', agentId);
    
    try {
      const url = `${RETELL_API_BASE}/list-calls`;
      console.log('Full URL:', url);
      
      // Build request body
      const requestBody = {
        limit: limit,
        sort_order: 'descending'
      };
      
      console.log('Request body:', JSON.stringify(requestBody));
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RETELL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
  
      console.log('Response status:', response.status);
      
      const responseText = await response.text();
  
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} - ${responseText}`);
      }
  
      let data = JSON.parse(responseText);
      console.log('Total calls from API:', data?.length || 0);
      
      // Filter by agent_id client-side if provided
      if (agentId && data && Array.isArray(data)) {
        data = data.filter(call => call.agent_id === agentId);
        console.log('Calls after agent_id filter:', data.length);
      }
      
      return data || [];
    } catch (error) {
      console.error('Error fetching calls:', error);
      return [];
    }
  },

  // Get agent config (includes begin_message / greeting)
  async getAgent(agentId) {
    try {
      const response = await fetch(`${RETELL_API_BASE}/get-agent/${agentId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${RETELL_API_KEY}`,
        }
      });
      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching agent:', error);
      return null;
    }
  },

  // Update the agent's greeting (begin_message)
  async updateAgentGreeting(agentId, beginMessage) {
    const response = await fetch(`${RETELL_API_BASE}/update-agent/${agentId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ begin_message: beginMessage })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API Error: ${response.status} - ${text}`);
    }
    return await response.json();
  },

  // Get a specific call by ID
  async getCall(callId) {
    try {
      const response = await fetch(`${RETELL_API_BASE}/get-call/${callId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RETELL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching call:', error);
      return null;
    }
  },

  // Transform Retell call data to match our dashboard format
  transformCallData(retellCall) {
    const analysis = retellCall.call_analysis || {};
    const customData = analysis.custom_analysis_data || {};

    return {
      id: retellCall.call_id,
      caller: customData.caller_name || 'Unknown',
      number: retellCall.from_number || customData.caller_phone_number || 'N/A',
      duration: this.formatDuration(retellCall.call_duration || 0),
      time: this.formatDateTime(retellCall.start_timestamp),
      outcome: this.determineOutcome(retellCall),
      hasRecording: !!retellCall.recording_url,
      hasTranscript: !!retellCall.transcript,
      recording_url: retellCall.recording_url,
      transcript: retellCall.transcript,
      call_summary: analysis.call_summary || '',
      appointment: {
        date: customData.appointment_date || null,
        time: customData.appointment_time || null,
        address: customData.appointment_address || null,
        city: customData.appointment_city || null,
        state: customData.appointment_state || null,
        zip: customData.appointment_zip || null
      }
    };
  },

  // Format duration from seconds to MM:SS
  formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  },

  // Format timestamp to readable date/time
  formatDateTime(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  },

  // Determine call outcome
  determineOutcome(call) {
    const analysis = call.call_analysis || {};
    const customData = analysis.custom_analysis_data || {};
    
    if (customData.appointment_date && customData.appointment_time) {
      return 'Appointment Booked';
    }
    if (analysis.call_successful) {
      return 'Information Request';
    }
    return 'Call Completed';
  },

  // Get appointments from calls
  async getAppointments(agentId = null) {
    const calls = await this.getCalls(100, agentId);
    const appointments = calls
      .map(call => this.transformCallData(call))
      .filter(call => call.appointment.date && call.appointment.time)
      .map(call => ({
        id: call.id,
        name: call.caller,
        date: call.appointment.date,
        time: call.appointment.time,
        address: call.appointment.address,
        city: call.appointment.city,
        state: call.appointment.state,
        zip: call.appointment.zip,
        status: this.getAppointmentStatus(call.appointment.date),
        phone: call.number,
        summary: call.call_summary
      }));

    return appointments;
  },

  // Determine appointment status based on date
  getAppointmentStatus(dateString) {
    if (!dateString) return 'pending';
    const appointmentDate = new Date(dateString);
    const now = new Date();
    
    // If appointment is in the past, it's completed
    if (appointmentDate < now) return 'completed';
    
    // If within 24 hours, confirmed, otherwise pending
    const hoursDiff = (appointmentDate - now) / (1000 * 60 * 60);
    return hoursDiff < 48 ? 'confirmed' : 'pending';
  }
};
