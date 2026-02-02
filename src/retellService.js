const RETELL_API_KEY = 'key_867f30efed6c101d9e2d8776e206';
const RETELL_API_BASE = 'https://api.retellai.com/v2';

export const retellService = {
  // Fetch all calls
  async getCalls(limit = 100) {
    try {
      const response = await fetch(`${RETELL_API_BASE}/list-calls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RETELL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const data = await response.json();
      return data.calls || [];
    } catch (error) {
      console.error('Error fetching calls:', error);
      return [];
    }
  },

  // Get a specific call by ID
  async getCall(callId) {
    try {
      const response = await fetch(`${RETELL_API_BASE}/get-call/${callId}`, {
        method: 'GET',
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
        service: this.extractServiceType(customData, analysis.call_summary)
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

  // Extract service type from custom data or summary
  extractServiceType(customData, summary) {
    // First check if you added a service_type field
    if (customData.service_type) {
      return customData.service_type;
    }
    
    // Otherwise try to extract from summary
    if (summary) {
      // Simple keyword matching - you can enhance this
      if (summary.toLowerCase().includes('consultation')) return 'Consultation';
      if (summary.toLowerCase().includes('follow-up')) return 'Follow-up';
      if (summary.toLowerCase().includes('initial')) return 'Initial Visit';
      if (summary.toLowerCase().includes('review')) return 'Review';
    }
    
    return 'General';
  },

  // Get appointments from calls
  async getAppointments() {
    const calls = await this.getCalls();
    const appointments = calls
      .map(call => this.transformCallData(call))
      .filter(call => call.appointment.date && call.appointment.time)
      .map(call => ({
        id: call.id,
        name: call.caller,
        date: call.appointment.date,
        time: call.appointment.time,
        service: call.appointment.service,
        address: call.appointment.address,
        status: this.getAppointmentStatus(call.appointment.date),
        phone: call.number
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
