const API_URL = 'http://195.224.100.11:8080/'

let START_OF_DAY = "";
let END_OF_DAY = "";
let g_min_trip_duration = 0;
let g_max_trip_duration = 0;

let g_open_slots_veh_1 = [];
let g_open_slots_veh_2 = [];

let g_loc_from;
let g_loc_to;

let g_map;

// load objects when html page has finished loading
$(document).ready(function() {
    // find out what dates are allowed for this trial service
    let availabilities = get_availabilities();

    let date_start = availabilities["date_start"];
    let date_end = availabilities["date_end"];

    let latest = date_today() > date_start ? date_today() : date_start;

    $( "#datepicker" ).datepicker({ minDate: new Date(latest), maxDate: new Date(date_end), showButtonPanel: true });
    
    // https://jqueryui.com/datepicker/#date-formats
    $( "#datepicker" ).datepicker( "option", "dateFormat", "dd/mm/yy" );
    
    // https://jqueryui.com/datepicker/#animation
    $( "#datepicker" ).datepicker( "option", "showAnim", "slideDown" );

    // Upon new date entry, clear time values
    document.getElementById("datepicker").addEventListener("click", datepicker_onclick);
    
    // Request availabilities that day upon picking new date
    $("#datepicker").on("change", datepicker_onchange);


    $('#start_time').on("change", start_time_onchange);

    // Request availabilities that day upon picking new date
    $("#datepicker").on("change", datepicker_onchange);

    // Update map and availabilities
    $("#loc_from").on("change", loc_from_onchange);

    // Update map and availabilities
    $("#loc_to").on("change", loc_to_onchange);

    // init map
    window.initMap = initMap;

    // set date to today
    document.getElementById("datepicker").value = datepicker_today();

    // update timeslots based on today's date
    g_loc_from = document.getElementById("loc_from").value;
    g_loc_to = document.getElementById("loc_to").value;
    update_start_time_ranges(g_loc_from, g_loc_to);

    // trigger locations changed callback after initialising them
    location_changed();

    // callback for booking request button
    document.getElementById('submit').onclick = booking_onsubmit;

});

function get_availabilities(loc_from="Putney_HQ", loc_to="Putney_HQ") {
    let url = API_URL + 'availabilities/?loc_from=' + loc_from + '&loc_to=' + loc_to; // + '&access_token=' + API_TOKEN
    return JSON.parse(http_get(url));
};


function http_get(theUrl)
{
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.open( "GET", theUrl, false ); // false for synchronous request
    xmlHttp.send( null );
    return xmlHttp.responseText;
}


// calculates the disabled intervals from the availability slots for each vehicle
function calc_disable_intervals_for_start_time(rsp_json, date) {

    var veh_1_list = rsp_json["Vehicle_1"];
    var veh_2_list = rsp_json["Vehicle_2"];

    let open_slots_veh_1 = veh_1_list[date];
    let open_slots_veh_2 = veh_1_list[date];

    let min_duration = rsp_json["min_rental_duration"];
    let allowed_start_1 = allowed_start_intervals(open_slots_veh_1, min_duration);
    let allowed_start_2 = allowed_start_intervals(open_slots_veh_2, min_duration);
    // returns an array of arrays like: [["08:30", "09:15"],["16:30", "17:45"]]

    // use global variables (don't like it though)
    // deep copy
    g_open_slots_veh_1 = [...open_slots_veh_1];
    g_open_slots_veh_2 = [...open_slots_veh_2];

    let start_of_day = rsp_json["time_start"];
    let end_of_day = rsp_json["time_end"];
    let non_allowed_start_1 = convert_to_excluded(allowed_start_1, start_of_day, end_of_day);
    let non_allowed_start_2 = convert_to_excluded(allowed_start_2, start_of_day, end_of_day);

    // calculate intersection of the non_allowed start times of both vehicles
    // for example: 
    // if vehicle 1 has non_allowed [['10:00', '11:30'], ['17:00', '17:50']]
    // and vehcile 2 has non_allowed [['10:30', '11:15'], ['17:10', '17:55']]
    // then the intersection is [['10:30', '11:15'], ['17:10', '17:50']]

    let non_allowed_start_any = calc_intersection_of_intervals(non_allowed_start_1, non_allowed_start_2);
    return non_allowed_start_any;
};


// support function to calculate allowed "start" ranges from the "availability" range
function allowed_start_intervals(allowed_times, min_duration) {
    let start_allowed = [];
    for (let i=0; i<allowed_times.length; i++){
        from = allowed_times[i]["from"];
        until = allowed_times[i]["until"];
        start_allowed.push([from, time_add(until,-min_duration)]);
    }
    return start_allowed;
}


// support function to convert the allowed "start time" range to an "excluded" range, 
// to be used for the timepicker grayed times
function convert_to_excluded(allowed_start, start_of_day, end_of_day) {
    // iterate over allowed intervals, and create excluded interval just before
    // and then add one at the end until the end-of-day 
    let excluded = []
    let number_of_slots = allowed_start.length;
    
    for (let i=0; i<number_of_slots; i++){    
        let start_of_slot = allowed_start[i][0];
        let end_of_slot = allowed_start[i][1];
        let start_of_excluded_slot = (i == 0) ? start_of_day : time_add(allowed_start[i-1][1],+1); // +1 to exclude last minute of allowed
        if (start_of_slot != start_of_day) {
            let new_interval = [start_of_excluded_slot.toString(), time_add(start_of_slot,-1)]; // -1 to exclude first minute of allowed
            excluded.push(new_interval);
        }
    }
    // now add the last step: until the end-of-day
    let end_of_last_slot = allowed_start[number_of_slots-1][1];
    if (end_of_last_slot != end_of_day) {
        let new_interval = [time_add(end_of_last_slot,+1), time_add(end_of_day,+1)];
        excluded.push(new_interval);
    }
    return excluded;
}


// support function to find intersection of time intervals (AND condition)
function calc_intersection_of_intervals(firstList, secondList) {
    let first = 0 // pointer for firstList
    let second = 0 // pointer for secondList
    let result = []

    while (first < firstList.length && second < secondList.length) {
        // largest starting point of the interval (firstList vs secondList)
        let maxStart = max_str_list([firstList[first][0], secondList[second][0]])
          
        // smallest end point of the interval
        let minEnd = max_str_list([firstList[first][1], secondList[second][1]])

        // if the intervals intersect
        if (maxStart <= minEnd) {
            new_intersection = [maxStart, minEnd];
            if (!contains(result, new_intersection)) {
                result.push(new_intersection);
            }
        }
            
        // move a pointer depending on which end point of the interval is smaller
        if (firstList[first][1] < secondList[second][1]) {
            first++
        } else {
            second++
        }
    }

    return result
};


// supporting functions to see if element "el" is contained in array "arr"
function contains(arr, el){
    if (arr.length == 0) {
        return false;
    }
    for (let i=0;i<arr.length;i++) {
        let equal = 0;
        for (let j=0;j<el.length;j++) {
            if (arr[i][j] == el[j]) {
                equal++;
            }
        }
        if (equal == el.length) {
            return true;
        }
    }
    return false;
}


// supporting function to find the max string in a list of strings
function max_str_list(list_of_strings) {
    let max = list_of_strings[0];
    for (let i=0;i<list_of_strings.length;i++){
        max = max > list_of_strings[i] ? max : list_of_strings[i];
    }
    return max;
}

// supporting function to find the min string in a list of strings
function min_str_list(list_of_strings) {
    let min = list_of_strings[0];
    for (let i=0;i<list_of_strings.length;i++){
        min = min < list_of_strings[i] ? min : list_of_strings[i];
    }
    return min;
}



// calculate the "end time" of a slot that contains the "start time"
function find_corresponding_end_time(start_time, open_slots) {
    for (let i=0; i<open_slots.length; i++) {
        slot_start = open_slots[i]["from"];
        slot_end = open_slots[i]["until"];
        if (slot_start <= start_time && start_time <= slot_end) {
            return time_add(slot_end, +1);
        }
    }
    // nothing found, return lowest value possible
    return "00:00";
}


// callback functions when "start_time" timepicker changes (updated by user)
function start_time_onchange() {
    let start_time = document.getElementById("start_time").value;

    end_time = max_str_list([
        find_corresponding_end_time(start_time, g_open_slots_veh_1), 
        find_corresponding_end_time(start_time, g_open_slots_veh_2)]);

    // limit end_time
    end_time = min_str_list([end_time, time_add(start_time, + g_max_trip_duration)]);

    if (end_time > time_add(END_OF_DAY, 1)){
        console.log("ERROR: end_time > END_OF_DAY");
        console.log("end_time: %s", end_time);
        end_time = time_add(END_OF_DAY, -0);
    }



    $('#end_time').timepicker({
        timeFormat: 'H:i',
        minTime: time_add(start_time, +g_min_trip_duration),
        maxTime: end_time,
        step: '15'    
    });

    document.getElementById("end_time").value = time_add(start_time, +g_min_trip_duration);
}


// callback when user clicks on calendar (auto resets "start_time" and "end_time")
function datepicker_onclick() {
    document.getElementById("start_time").value = "";
    document.getElementById("end_time").value = "";
}


function update_start_time_ranges() {
    let date_input = convert_dateformat(document.getElementById("datepicker").value);
    let availabilities = get_availabilities(g_loc_from, g_loc_to);
    disable_range_all_vehicles = calc_disable_intervals_for_start_time(availabilities, date_input);

    let start_of_day = availabilities["time_start"];
    let end_of_day = availabilities["time_end"];

    // save global variables
    START_OF_DAY = start_of_day;
    END_OF_DAY = end_of_day;
    g_min_trip_duration = availabilities["min_rental_duration"];
    g_max_trip_duration = availabilities["max_rental_duration"];

    if (date_input == date_today()) {
        disable_range_all_vehicles.push([START_OF_DAY, time_now()]);
    }

    $('#start_time').timepicker({
        timeFormat: 'H:i',
        minTime: start_of_day,
        maxTime: end_of_day,
        step: '15',
        disableTimeRanges: disable_range_all_vehicles
    });

    $('#end_time').timepicker({
        timeFormat: 'H:i',
        minTime: start_of_day,
        maxTime: end_of_day,
        step: '15',
        disableTimeRanges: disable_range_all_vehicles
    });
}

// callback when user picked new date on calendar
function datepicker_onchange() {
    update_start_time_ranges(g_loc_from, g_loc_to);
}

function location_changed() {
    update_start_time_ranges(g_loc_from, g_loc_to);

    document.getElementById("start_time").value = "";
    document.getElementById("end_time").value = "";

    if (g_loc_from == "Putney_HQ" || g_loc_to == "Putney_HQ") {
        g_marker_putney.setVisible(true);
    }
    else {
        g_marker_putney.setVisible(false);
    }

    if (g_loc_from == "QMP" || g_loc_to == "QMP") {
        g_marker_qmp.setVisible(true);
    }
    else {
        g_marker_qmp.setVisible(false);
    }
}

function loc_from_onchange() {
    g_loc_from = document.getElementById("loc_from").value;
    location_changed();
}

function loc_to_onchange() {
    g_loc_to = document.getElementById("loc_to").value;
    location_changed();
}





// get time now in "HH:mm" format
function time_now() {
    const d = new Date();
    let text = d.toTimeString().substring(0,5);
    return text;
}

// get today's date in "yyyy-mm-dd" format
function date_today() {
    var today = new Date();
    var dd = today.getDate();
    var mm = today.getMonth() + 1;
    var yyyy = today.getFullYear();
    if (dd < 10) {
        dd = '0' + dd;
    }
    if (mm < 10) {
        mm = '0' + mm;
    }
    today = yyyy + '-' + mm + '-' + dd;
    return today;
};

// convert date format from "dd/mm/yyyy" to "yyyy-mm-dd" format
function convert_dateformat(ddmmyy) {
    var yyyy = ddmmyy.substring(6,10);
    var mm = ddmmyy.substring(3,5);
    var dd = ddmmyy.substring(0,2);
    date = yyyy + '-' + mm + '-' + dd;
    return date;
}

// get today's date in a "dd/mm/yyyy" format
function datepicker_today() {
    var today = new Date();
    var dd = today.getDate();
    var mm = today.getMonth() + 1;
    var yyyy = today.getFullYear();
    if (dd < 10) {
        dd = '0' + dd;
    }
    if (mm < 10) {
        mm = '0' + mm;
    }
    today = dd + '/' + mm + '/' + yyyy;
    return today;
};


// high level api to add or subtract integer (in minutes) from "HH:MM" time format
function time_add(base_str, addition_mins) {
    let str = t_to_str(t_to_mins(base_str) + addition_mins);
    return str;
}


// convert "HH:MM" to number in minutes
function t_to_mins(time_str) {
    return time_diff_in_minutes("00:00", time_str)
}

// convert number in minutes to string (with leading 0 if necessary)
function convert_num_to_string(num, size) {
    let str = num.toString();
    while (str.length < size) str = "0" + str;
    return str;
}

// convert number in minutes to "HH:MM"
function t_to_str(time_mins) {
    let hours = parseInt(time_mins/60);
    let minutes = time_mins % 60
    return convert_num_to_string(hours, 2) + ':' + convert_num_to_string(minutes, 2)
}

// calc diff in time (using "HH:MM" formatting)
function time_diff_in_minutes(earlier, later) {
    var hrs_0 = parseInt(earlier.split(":")[0]);
    var mins_0 = parseInt(earlier.split(":")[1]);
    var hrs_1 = parseInt(later.split(":")[0]);
    var mins_1 = parseInt(later.split(":")[1]);
    return (hrs_1-hrs_0)*60 + (mins_1-mins_0)
}


// Initialize and add the map
function initMap() {
    const loc_qmp = { lat: 51.455037, lng: -0.2427931 };
    const loc_putney = { lat: 51.460597, lng: -0.215740 };
    g_map = new google.maps.Map(document.getElementById("map"), {
        zoom: 14,
        center: { lat: 51.4574601, lng: -0.2268944 },
        disableDefaultUI: true,
    });


    const icon_trilvee = {
        url: "./trilvee_100x75.svg", // url
        scaledSize: new google.maps.Size(80, 60), // scaled size
        origin: new google.maps.Point(0, 0), // origin
        anchor: new google.maps.Point(40, 30) // anchor
    };

    g_marker_qmp = new google.maps.Marker({
        position: loc_qmp,
        icon: icon_trilvee,
        title:"Queen Mary's Place",
    });

    g_marker_putney = new google.maps.Marker({
        position: loc_putney,
        icon: icon_trilvee,
        title:"Putney (Trilvee HQ)",
    });

    // Create an info window to share between markers.
    const infoWindow = new google.maps.InfoWindow();

    g_marker_qmp.setMap(g_map);
    g_marker_putney.setMap(g_map);

    // Add a click listener for each marker, and set up the info window.
    g_marker_qmp.addListener("click", () => {
      infoWindow.close();
      infoWindow.setContent(g_marker_qmp.getTitle());
      infoWindow.open(g_marker_qmp.getMap(), g_marker_qmp);
    });

    g_marker_putney.addListener("click", () => {
      infoWindow.close();
      infoWindow.setContent(g_marker_putney.getTitle());
      infoWindow.open(g_marker_putney.getMap(), g_marker_putney);
    });

}

function booking_onsubmit() {
    // let name = document.getElementById("name").value;
    let email = document.getElementById("email").value;
    let phone = document.getElementById("phone").value;
    let loc_from = document.getElementById("loc_from").value;
    let loc_to = document.getElementById("loc_to").value;
    let date = convert_dateformat(document.getElementById("datepicker").value);
    let start_time = document.getElementById("start_time").value;
    let end_time = document.getElementById("end_time").value;
    
    let url = API_URL + 'request_new_booking/?';
    url += 'phone_number=' + phone + '&';
    url += 'email=' + email + '&';
    // TODO: name
    url += 'date=' + date + '&';
    url += 'pickup_location=' + loc_from + '&';
    url += 'pickup_time=' + start_time + '&';
    url += 'dropoff_location=' + loc_to + '&';
    url += 'dropoff_time=' + end_time; 

    let rsp = http_get(url);
    let rsp_json = JSON.parse(rsp);

    console.log(rsp_json);

    if (rsp_json['booking']) {
        console.log("Booking UID found.");
        window.open('./success.html', '_self');
    }
    else {
        if (rsp_json['message'].includes("email address is not authorized")) {
            window.open('./fail_email_not_auth.html', '_self');
        }
        else {
            window.open('./fail_default.html', '_self');
        }
    }
}