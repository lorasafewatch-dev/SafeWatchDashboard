-- Apply this migration to an existing database. It preserves tables and records.
-- Do not run setup.sql on an existing installation: that script drops tables.
CREATE OR REPLACE FUNCTION check_geofence()
RETURNS TRIGGER AS $$
DECLARE
    is_inside BOOLEAN;
    san_isidro_boundary GEOGRAPHY;
BEGIN
    san_isidro_boundary := 'POLYGON((121.145 14.045, 121.160 14.045, 121.160 14.030, 121.145 14.030, 121.145 14.045))'::GEOGRAPHY;
    is_inside := ST_Within(NEW.location::geometry, san_isidro_boundary::geometry);

    IF NEW.location IS NOT NULL
       AND NOT ST_Equals(NEW.location::geometry, ST_SetSRID(ST_MakePoint(0, 0), 4326))
       AND NOT is_inside THEN
        INSERT INTO alerts (device_id, alert_type, details)
        VALUES (NEW.device_id, 'GEOFENCE', jsonb_build_object('location', ST_AsText(NEW.location)));
    END IF;
    IF NEW.is_sos THEN
        INSERT INTO alerts (device_id, alert_type, details)
        VALUES (NEW.device_id, 'SOS', jsonb_build_object('location', ST_AsText(NEW.location)));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
