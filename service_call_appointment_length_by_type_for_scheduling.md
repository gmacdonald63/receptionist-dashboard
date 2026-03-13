# Service Call Appointment Length by Type for Scheduling

## Purpose

This document provides standardized HVAC service call categories and
recommended appointment lengths.\
It is designed to be used in AI receptionists and dispatch systems to
schedule the correct amount of time for HVAC service appointments.

The durations listed represent typical contractor scheduling blocks
based on industry practices.

------------------------------------------------------------------------

# 1. Primary HVAC Service Call Categories

## Emergency Service Calls

Urgent system failures requiring immediate dispatch.

Examples: - No heat during winter - AC failure during extreme heat - Gas
smell or carbon monoxide concern - Refrigerant leak - Electrical failure

Recommended scheduling block:

**90--120 minutes (initial visit)**

Follow-up repair may require additional scheduling.

------------------------------------------------------------------------

## Diagnostic Service Calls

A technician visits to determine the cause of a problem.

Common customer descriptions: - AC not cooling - Furnace not turning
on - Unit making strange noise - Thermostat not responding - Water
leaking from system

Recommended scheduling block:

**60--90 minutes**

If the repair is complex, a follow‑up visit may be required.

------------------------------------------------------------------------

## Preventive Maintenance Calls

Routine service intended to prevent system failures.

Typical tasks include:

-   Checking refrigerant levels
-   Cleaning coils
-   Inspecting electrical connections
-   Lubricating components
-   Testing safety controls
-   Checking thermostat calibration

Recommended scheduling block:

**60--120 minutes**

Typical frequency: twice per year.

------------------------------------------------------------------------

## Repair Service Calls

Repair calls occur when the problem is already known or diagnosed.

Typical repair durations:

Minor repair: **30--60 minutes**

Standard repair: **1--3 hours**

Major repair: **4+ hours**

Examples:

-   Capacitor replacement
-   Fan motor replacement
-   Refrigerant recharge
-   Drain line clearing
-   Electrical repair

------------------------------------------------------------------------

## Installation or Replacement Calls

Examples:

-   Air conditioner installation
-   Furnace replacement
-   Heat pump installation
-   Mini‑split installation
-   Thermostat installation

Scheduling blocks:

Estimate visit: **60--120 minutes**

Full installation: **4--8 hours**

Large installations may require a full workday.

------------------------------------------------------------------------

# 2. Cooling System Service Types

## AC Not Cooling

Possible causes:

-   Refrigerant leak
-   Dirty condenser coil
-   Compressor failure
-   Electrical issue

Recommended schedule:

**90 minutes diagnostic**

------------------------------------------------------------------------

## AC Not Turning On

Possible causes:

-   Thermostat failure
-   Capacitor failure
-   Electrical issue

Recommended schedule:

**60--90 minutes**

------------------------------------------------------------------------

## AC Making Loud Noise

Possible causes:

-   Fan motor issue
-   Loose components
-   Compressor issue

Recommended schedule:

**60--90 minutes**

------------------------------------------------------------------------

## AC Freezing Up

Possible causes:

-   Refrigerant problem
-   Airflow restriction
-   Dirty evaporator coil

Recommended schedule:

**90 minutes**

------------------------------------------------------------------------

# 3. Heating System Service Types

## Furnace Not Working

Possible causes:

-   Ignition failure
-   Gas valve issue
-   Control board issue

Recommended schedule:

**90 minutes**

------------------------------------------------------------------------

## Furnace Blowing Cold Air

Possible causes:

-   Flame sensor issue
-   Thermostat problem
-   Gas supply problem

Recommended schedule:

**60--90 minutes**

------------------------------------------------------------------------

## Heat Pump Not Heating

Possible causes:

-   Defrost board failure
-   Reversing valve issue
-   Refrigerant leak

Recommended schedule:

**90 minutes**

------------------------------------------------------------------------

# 4. Airflow and Comfort Issues

## Uneven Heating or Cooling

Possible causes:

-   Duct leaks
-   Damper problems
-   Airflow restrictions

Recommended schedule:

**90 minutes**

------------------------------------------------------------------------

## Weak Airflow

Possible causes:

-   Dirty filter
-   Blower motor issue
-   Duct blockage

Recommended schedule:

**60--90 minutes**

------------------------------------------------------------------------

# 5. Water Leak Calls

## Water Leaking From HVAC Unit

Possible causes:

-   Clogged condensate drain
-   Frozen evaporator coil
-   Broken condensate pump

Recommended schedule:

**60 minutes**

------------------------------------------------------------------------

# 6. Electrical Issues

## Breaker Tripping When HVAC Runs

Possible causes:

-   Compressor short
-   Wiring issue
-   Fan motor problem

Recommended schedule:

**90--120 minutes**

------------------------------------------------------------------------

# 7. Indoor Air Quality Calls

Examples:

-   High humidity
-   Dust or allergy concerns
-   Poor ventilation

Recommended schedule:

**60--90 minutes**

------------------------------------------------------------------------

# 8. Maintenance Calls

## Seasonal HVAC Tune‑Up

Typical tasks:

-   Coil cleaning
-   Refrigerant level check
-   Electrical inspection
-   Performance testing

Recommended schedule:

**1--2 hours**

------------------------------------------------------------------------

# 9. AI Intake Questions for Call Classification

The AI receptionist should gather:

System type:

-   Furnace
-   Air conditioner
-   Heat pump
-   Mini‑split
-   Not sure

Problem description:

-   System not working
-   Not heating or cooling properly
-   Strange noise
-   Water leak
-   Routine maintenance

Urgency:

-   Is the system completely not working?
-   Do you smell gas or burning?

If safety risk is reported, treat as **emergency dispatch**.

------------------------------------------------------------------------

# 10. Scheduling Duration Matrix

  Service Type          Recommended Time
  --------------------- ------------------
  Diagnostic visit      60--90 minutes
  Minor repair          60 minutes
  Standard repair       1--3 hours
  Major repair          4 hours
  Maintenance tune-up   1--2 hours
  Estimate visit        60--120 minutes
  Emergency call        90 minutes
  Installation          4--8 hours

------------------------------------------------------------------------

# 11. AI Scheduling Rules

Rule 1 --- Unknown problem\
Schedule diagnostic visit: **90 minutes**

Rule 2 --- Maintenance\
Schedule **60--120 minutes**

Rule 3 --- Known repair\
Schedule **1--3 hours**

Rule 4 --- Emergency issue\
Schedule **next available technician** with **90‑minute block**

------------------------------------------------------------------------

# 12. Suggested Job Types for AI Scheduling

-   AC not cooling
-   AC not turning on
-   AC freezing
-   AC making noise
-   AC leaking water
-   Furnace not heating
-   Furnace blowing cold air
-   Heat pump not heating
-   Thermostat not working
-   Breaker tripping
-   Weak airflow
-   Uneven temperature
-   HVAC tune-up
-   HVAC inspection
-   HVAC replacement estimate
-   Duct inspection
-   Air quality consultation

------------------------------------------------------------------------

# 13. Recommended Data Structure for Scheduling Systems

Each job type should include:

-   Job type
-   Symptoms
-   Equipment type
-   Urgency level
-   Estimated duration
-   Technician skill level
-   Required parts

Example:

Job: AC Not Cooling\
Type: Diagnostic\
Duration: 90 minutes\
Technician: HVAC Service Technician
