# Proposed Service Types for Retell Tool Enum + Supabase `service_types` Table

- **Service Name** = the enum value the LLM selects (clean, no prefix)
- **Category** = stored in a separate `category` column in the DB for display/filtering in the dashboard
- **Duration** = drives appointment slot sizing in `check-availability` and `book-appointment`

| # | Category | Service Name (enum value) | Duration (min) |
|---|----------|---------------------------|----------------|
| 1 | Diagnostics | HVAC System Diagnostic | 45 |
| 2 | Diagnostics | AC Diagnostic | 45 |
| 3 | Diagnostics | Furnace Diagnostic | 45 |
| 4 | Diagnostics | Heat Pump Diagnostic | 45 |
| 5 | Diagnostics | Boiler Diagnostic | 60 |
| 6 | Diagnostics | Thermostat Diagnostic | 30 |
| 7 | Diagnostics | Electrical Diagnostic | 60 |
| 8 | Diagnostics | Airflow Diagnostic | 45 |
| 9 | Diagnostics | Static Pressure Test | 60 |
| 10 | Diagnostics | Refrigerant Leak Detection | 60 |
| 11 | Diagnostics | Refrigerant Pressure Check | 45 |
| 12 | Diagnostics | Compressor Diagnostic | 60 |
| 13 | Diagnostics | Blower Motor Diagnostic | 45 |
| 14 | Diagnostics | Condenser Fan Diagnostic | 45 |
| 15 | Diagnostics | Ignition System Diagnostic | 45 |
| 16 | Diagnostics | Gas Pressure Test | 45 |
| 17 | Diagnostics | Combustion Analysis | 60 |
| 18 | Diagnostics | Heat Exchanger Inspection | 60 |
| 19 | Diagnostics | Indoor Air Quality Test | 60 |
| 20 | Diagnostics | Duct Leakage Test | 90 |
| 21 | Diagnostics | Energy Efficiency Assessment | 90 |
| 22 | Diagnostics | Load Calculation (Manual J) | 120 |
| 23 | Diagnostics | HVAC System Inspection | 60 |
| 24 | Diagnostics | Seasonal HVAC Inspection | 60 |
| 25 | Maintenance | HVAC Preventive Maintenance | 90 |
| 26 | Maintenance | AC Tune-Up | 75 |
| 27 | Maintenance | Furnace Tune-Up | 75 |
| 28 | Maintenance | Heat Pump Maintenance | 75 |
| 29 | Maintenance | Boiler Maintenance | 75 |
| 30 | Maintenance | Condenser Coil Cleaning | 90 |
| 31 | Maintenance | Evaporator Coil Cleaning | 90 |
| 32 | Maintenance | Blower Motor Service | 60 |
| 33 | Maintenance | Condenser Unit Maintenance | 60 |
| 34 | Maintenance | Air Handler Maintenance | 60 |
| 35 | Maintenance | Filter Replacement | 20 |
| 36 | Maintenance | Belt Replacement | 45 |
| 37 | Maintenance | Lubricate Moving Parts | 45 |
| 38 | Maintenance | Electrical Connection Tightening | 45 |
| 39 | Maintenance | Refrigerant Level Check | 45 |
| 40 | Maintenance | Capacitor Testing | 30 |
| 41 | Maintenance | Thermostat Calibration | 30 |
| 42 | Maintenance | Flame Sensor Cleaning | 45 |
| 43 | Maintenance | Burner Cleaning | 60 |
| 44 | Maintenance | Drain Line Cleaning | 45 |
| 45 | Maintenance | Vent Inspection | 45 |
| 46 | Maintenance | Safety Control Check | 45 |
| 47 | Maintenance | Fan Blade Cleaning | 45 |
| 48 | Maintenance | Inducer Motor Cleaning | 60 |
| 49 | Repairs | Thermostat Repair | 45 |
| 50 | Repairs | Thermostat Replacement | 60 |
| 51 | Repairs | Capacitor Replacement | 45 |
| 52 | Repairs | Contactor Replacement | 60 |
| 53 | Repairs | Blower Motor Replacement | 120 |
| 54 | Repairs | Condenser Fan Motor Replacement | 120 |
| 55 | Repairs | Inducer Motor Replacement | 120 |
| 56 | Repairs | Compressor Replacement | 270 |
| 57 | Repairs | Refrigerant Recharge | 60 |
| 58 | Repairs | Refrigerant Leak Repair | 120 |
| 59 | Repairs | TXV Replacement | 120 |
| 60 | Repairs | Expansion Valve Replacement | 120 |
| 61 | Repairs | Ignitor Replacement | 45 |
| 62 | Repairs | Flame Sensor Replacement | 45 |
| 63 | Repairs | Circuit Board Replacement | 90 |
| 64 | Repairs | Transformer Replacement | 60 |
| 65 | Repairs | Wiring Repair | 120 |
| 66 | Repairs | Breaker Replacement | 60 |
| 67 | Repairs | Gas Valve Replacement | 90 |
| 68 | Repairs | Pilot Assembly Repair | 60 |
| 69 | Repairs | Heat Exchanger Repair | 180 |
| 70 | Repairs | Condensate Pump Replacement | 60 |
| 71 | Repairs | Drain Pan Replacement | 90 |
| 72 | Repairs | Air Handler Repair | 120 |
| 73 | Repairs | Furnace Repair | 120 |
| 74 | Repairs | AC Repair | 120 |
| 75 | Repairs | Heat Pump Repair | 120 |
| 76 | Installation | HVAC System Installation | 360 |
| 77 | Installation | HVAC System Replacement | 480 |
| 78 | Installation | Furnace Installation | 360 |
| 79 | Installation | Furnace Replacement | 360 |
| 80 | Installation | Central AC Installation | 360 |
| 81 | Installation | AC Replacement | 360 |
| 82 | Installation | Heat Pump Installation | 360 |
| 83 | Installation | Heat Pump Replacement | 360 |
| 84 | Installation | Boiler Installation | 360 |
| 85 | Installation | Boiler Replacement | 360 |
| 86 | Installation | Air Handler Installation | 240 |
| 87 | Installation | Mini-Split Installation | 240 |
| 88 | Installation | Mini-Split Multi-Zone Install | 360 |
| 89 | Installation | Thermostat Installation | 45 |
| 90 | Installation | Smart Thermostat Installation | 45 |
| 91 | Installation | Zoning System Installation | 240 |
| 92 | Installation | Zone Control Board Installation | 120 |
| 93 | Installation | Zone Damper Installation | 120 |
| 94 | Installation | Whole-House Fan Installation | 180 |
| 95 | Ductwork | Ductwork Installation | 360 |
| 96 | Ductwork | Ductwork Replacement | 360 |
| 97 | Ductwork | Duct Repair | 120 |
| 98 | Ductwork | Duct Sealing | 180 |
| 99 | Ductwork | Duct Insulation | 180 |
| 100 | Ductwork | Air Duct Cleaning | 180 |
| 101 | Ductwork | Vent Installation | 120 |
| 102 | Ductwork | Vent Repair | 90 |
| 103 | Ductwork | Register Replacement | 45 |
| 104 | Ductwork | Return Air Installation | 180 |
| 105 | Ventilation | ERV Installation | 240 |
| 106 | Ventilation | HRV Installation | 240 |
| 107 | Ventilation | Ventilation Fan Installation | 120 |
| 108 | Ventilation | Exhaust Fan Installation | 120 |
| 109 | Ventilation | Attic Ventilation Installation | 240 |
| 110 | Ventilation | Dryer Vent Cleaning | 90 |
| 111 | Ventilation | Ventilation System Repair | 120 |
| 112 | Indoor Air Quality | Whole-House Air Purifier Installation | 120 |
| 113 | Indoor Air Quality | Electronic Air Cleaner Install | 120 |
| 114 | Indoor Air Quality | UV Light Installation | 90 |
| 115 | Indoor Air Quality | Humidifier Installation | 180 |
| 116 | Indoor Air Quality | Humidifier Repair | 90 |
| 117 | Indoor Air Quality | Dehumidifier Installation | 180 |
| 118 | Indoor Air Quality | Dehumidifier Repair | 90 |
| 119 | Indoor Air Quality | Air Scrubber Installation | 120 |
| 120 | Indoor Air Quality | Media Filter Installation | 60 |
| 121 | Indoor Air Quality | Carbon Filter Installation | 60 |
| 122 | Indoor Air Quality | HEPA Filter Installation | 60 |
| 123 | Controls | Thermostat Programming | 30 |
| 124 | Controls | HVAC Zoning Setup | 120 |
| 125 | Controls | Smart Home HVAC Integration | 90 |
| 126 | Controls | Building Automation Setup | 180 |
| 127 | Controls | Control Board Programming | 90 |
| 128 | System Design | HVAC System Design Consultation | 120 |
| 129 | System Design | Energy Efficiency Upgrade Consultation | 90 |
| 130 | System Design | HVAC Retrofit Planning | 120 |
| 131 | System Design | Duct Design Calculation | 120 |
| 132 | Commercial | Rooftop Unit Diagnostic | 60 |
| 133 | Commercial | Rooftop Unit Maintenance | 90 |
| 134 | Commercial | Rooftop Unit Repair | 180 |
| 135 | Commercial | Rooftop Unit Installation | 480 |
| 136 | Commercial | Make-Up Air Unit Service | 180 |
| 137 | Commercial | VAV Box Service | 120 |
| 138 | Commercial | Cooling Tower Inspection | 120 |
| 139 | Commercial | Chiller Inspection | 180 |
| 140 | Commercial | Chiller Repair | 240 |
| 141 | Commercial | Walk-In Cooler Repair | 120 |
| 142 | Commercial | Walk-In Freezer Repair | 120 |
| 143 | Geothermal | Geothermal System Diagnostic | 60 |
| 144 | Geothermal | Geothermal Heat Pump Service | 120 |
| 145 | Geothermal | Geothermal Loop Inspection | 180 |
| 146 | Geothermal | Geothermal Installation | 480 |
| 147 | Hydronic | Hydronic Heating Diagnostic | 60 |
| 148 | Hydronic | Radiant Floor Heating Repair | 120 |
| 149 | Hydronic | Circulator Pump Replacement | 120 |
| 150 | Hydronic | Expansion Tank Replacement | 90 |
| 151 | Hydronic | Boiler Circulation Repair | 120 |
| 152 | Emergency | Emergency HVAC Repair | 120 |
| 153 | Emergency | Emergency AC Repair | 120 |
| 154 | Emergency | Emergency Heating Repair | 120 |
| 155 | Emergency | No Heat Emergency Call | 90 |
| 156 | Emergency | No Cooling Emergency Call | 90 |

---

## Duration Summary by Category

| Category | Count | Duration Range |
|----------|-------|----------------|
| Diagnostics | 24 | 30 - 120 min |
| Maintenance | 24 | 20 - 90 min |
| Repairs | 27 | 45 - 270 min |
| Installation | 19 | 45 - 480 min |
| Ductwork | 10 | 45 - 360 min |
| Ventilation | 7 | 90 - 240 min |
| Indoor Air Quality | 11 | 60 - 180 min |
| Controls | 5 | 30 - 180 min |
| System Design | 4 | 90 - 120 min |
| Commercial | 11 | 60 - 480 min |
| Geothermal | 4 | 60 - 480 min |
| Hydronic | 5 | 60 - 120 min |
| Emergency | 5 | 90 - 120 min |
| **TOTAL** | **156** | **20 - 480 min** |
