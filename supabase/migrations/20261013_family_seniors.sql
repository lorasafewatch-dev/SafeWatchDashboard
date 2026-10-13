-- Additive family senior management. Existing watches and history are retained.
BEGIN;

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS age SMALLINT CHECK (age BETWEEN 0 AND 130);
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS gender TEXT;

CREATE TABLE IF NOT EXISTS public.family_seniors (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, device_id)
);
ALTER TABLE public.family_seniors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.family_seniors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.family_seniors TO authenticated;
GRANT ALL ON TABLE public.family_seniors TO service_role;

DROP POLICY IF EXISTS "Family reads own seniors" ON public.family_seniors;
CREATE POLICY "Family reads own seniors" ON public.family_seniors
    FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Family links own seniors" ON public.family_seniors;
CREATE POLICY "Family links own seniors" ON public.family_seniors
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Family removes own senior links" ON public.family_seniors;
CREATE POLICY "Family removes own senior links" ON public.family_seniors
    FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.link_family_senior(p_device_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, auth
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in again' USING ERRCODE = '42501'; END IF;
    PERFORM 1 FROM public.devices WHERE id = p_device_id AND patient_name <> '[HIDDEN]';
    IF NOT FOUND THEN RAISE EXCEPTION 'This watch is not registered or is unavailable' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.family_seniors(user_id, device_id) VALUES (auth.uid(), p_device_id)
    ON CONFLICT (user_id, device_id) DO NOTHING;
    RETURN p_device_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_family_senior(
    p_device_id UUID, p_name TEXT, p_age INTEGER DEFAULT NULL, p_gender TEXT DEFAULT 'Not specified')
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, auth
AS $$
DECLARE
    inserted_id UUID;
    clean_name TEXT := btrim(p_name);
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in again' USING ERRCODE = '42501'; END IF;
    IF clean_name IS NULL OR length(clean_name) NOT BETWEEN 1 AND 100 OR clean_name = '[HIDDEN]' THEN
        RAISE EXCEPTION 'Enter a valid senior name' USING ERRCODE = '22023';
    END IF;
    IF p_age IS NOT NULL AND p_age NOT BETWEEN 0 AND 130 THEN
        RAISE EXCEPTION 'Enter an age from 0 to 130' USING ERRCODE = '22023';
    END IF;
    IF p_gender IS NULL OR p_gender NOT IN ('Male', 'Female', 'Other', 'Not specified') THEN
        RAISE EXCEPTION 'Choose a valid gender' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.devices(id, patient_name, device_name, age, gender)
    VALUES (p_device_id, clean_name, 'SafeWatch Watch (' || p_gender || ')'
        || CASE WHEN p_age IS NOT NULL THEN ' (' || p_age || ')' ELSE '' END, p_age, p_gender)
    ON CONFLICT (id) DO NOTHING RETURNING id INTO inserted_id;
    IF inserted_id IS NULL THEN
        -- A retry of the same successful registration is safe. Never overwrite
        -- another registered senior or change an existing watch's assignment.
        PERFORM 1 FROM public.devices d JOIN public.family_seniors f ON f.device_id = d.id
        WHERE d.id = p_device_id AND f.user_id = auth.uid() AND d.patient_name = clean_name
          AND d.age IS NOT DISTINCT FROM p_age AND d.gender = p_gender;
        IF FOUND THEN RETURN p_device_id; END IF;
        RAISE EXCEPTION 'This Watch ID is already registered. Link the existing senior instead.' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.family_seniors(user_id, device_id) VALUES (auth.uid(), p_device_id);
    RETURN p_device_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_family_senior(p_device_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, auth
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in again' USING ERRCODE = '42501'; END IF;
    DELETE FROM public.family_seniors WHERE user_id = auth.uid() AND device_id = p_device_id;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.link_family_senior(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_family_senior(UUID, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_family_senior(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_family_senior(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_family_senior(UUID, TEXT, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_family_senior(UUID) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
