import { supabase } from './supabase';

/**
 * Calculates RSVP statistics from an array of RSVP records.
 */
export function calculateStatsFromRsvps(rsvps) {
  let totalSubmissions = rsvps.length;
  let attendingSubmissions = 0;
  let declinedSubmissions = 0;
  let totalExpectedAttendees = 0;

  const eventCounts = {
    mehendi: 0,
    sangeeth: 0,
    haldi: 0,
    pelli_rituals: 0,
    wedding: 0,
  };

  for (const rsvp of rsvps) {
    if (rsvp.attendance_status === 'attending') {
      attendingSubmissions++;
      const count = parseInt(rsvp.attendees_count, 10) || 1;
      totalExpectedAttendees += count;

      if (Array.isArray(rsvp.selected_events)) {
        const accountedEvents = new Set();
        for (const evId of rsvp.selected_events) {
          let mappedIds = [evId];
          if (evId === 'mehendi_sangeeth') {
            mappedIds = ['mehendi', 'sangeeth'];
          } else if (evId === 'haldi_pelli') {
            mappedIds = ['haldi', 'pelli_rituals'];
          } else if (evId === 'wedding_ceremony') {
            mappedIds = ['wedding'];
          } else if (evId === 'pelli_ceremony') {
            mappedIds = ['pelli_rituals'];
          }

          for (const targetId of mappedIds) {
            if (eventCounts[targetId] !== undefined && !accountedEvents.has(targetId)) {
              accountedEvents.add(targetId);
              eventCounts[targetId] += count;
            }
          }
        }
      }
    } else {
      declinedSubmissions++;
    }
  }

  return {
    totalSubmissions,
    attendingSubmissions,
    declinedSubmissions,
    totalExpectedAttendees,
    eventCounts,
  };
}

/**
 * Fetches all RSVPs directly from Supabase Cloud.
 */
export async function fetchRsvpsFromSupabase() {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not configured' };
  }
  try {
    const { data, error } = await supabase
      .from('rsvps')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Supabase Client] Fetch error:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, data: data || [] };
  } catch (err) {
    console.error('[Supabase Client] Fetch exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Deletes an RSVP directly from Supabase Cloud.
 */
export async function deleteRsvpFromSupabase(id) {
  if (!supabase) return { success: false };
  try {
    const { error } = await supabase.from('rsvps').delete().eq('id', id);
    if (error) {
      console.error('[Supabase Client] Delete error:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Submits RSVP form data directly to the Supabase 'rsvps' table.
 */
export async function submitRsvp(formData) {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not available' };
  }
  try {
    const guestName = formData.guest_name || formData.fullName || 'Valued Guest';
    const guestEmail = formData.guest_email || formData.email || '';
    const status = formData.attendance_status || (formData.attendingWedding !== false ? 'attending' : 'declined');

    const record = {
      guest_name: String(guestName).trim(),
      guest_email: String(guestEmail).trim().toLowerCase(),
      phone_number: formData.phone_number || formData.phoneNumber || null,
      attendance_status: status === 'declined' ? 'declined' : 'attending',
      attendees_count: status === 'attending' ? parseInt(formData.attendees_count || formData.totalAttendees, 10) || 1 : 0,
      additional_guests: formData.additional_guests || formData.additionalGuests || '',
      selected_events: Array.isArray(formData.selected_events) ? formData.selected_events : [],
      dietary_requirements: formData.dietary_requirements || formData.dietaryRequirements || '',
      special_requests: formData.special_requests || formData.message || '',
    };

    const { data, error } = await supabase
      .from('rsvps')
      .insert([record])
      .select()
      .single();

    if (error) {
      console.error('Supabase RSVP insert error:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err) {
    console.error('RSVP submission error:', err);
    return {
      success: false,
      error: err.message || 'An unexpected error occurred while saving your RSVP.',
    };
  }
}
